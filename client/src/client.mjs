import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const HUB_WS_URL = process.env.HUB_WS_URL;
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const EXEC_ENABLED = (process.env.EXEC_ENABLED || 'true').toLowerCase() === 'true';
const RECONNECT_MS = Number(process.env.RECONNECT_MS || 3000);
const MAX_OUTPUT_BYTES = Number(process.env.MAX_OUTPUT_BYTES || 1_048_576);
const PID_FILE = path.resolve(process.cwd(), 'client.pid');

if (!HUB_WS_URL) throw new Error('HUB_WS_URL is required');
if (!AGENT_TOKEN || AGENT_TOKEN.length < 24) throw new Error('AGENT_TOKEN is required');

fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');

function cleanupPid() {
  try {
    if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}
process.on('exit', cleanupPid);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

function appendLimited(chunks, chunk, state) {
  if (state.bytes >= MAX_OUTPUT_BYTES) return;
  const buf = Buffer.from(chunk);
  const remaining = MAX_OUTPUT_BYTES - state.bytes;
  chunks.push(buf.subarray(0, remaining));
  state.bytes += Math.min(buf.length, remaining);
  if (buf.length > remaining) state.truncated = true;
}

async function executeCommand(params) {
  if (!EXEC_ENABLED) throw new Error('Command execution is disabled on this client');

  const command = String(params.command || '');
  if (!command || command.length > 20_000) throw new Error('Invalid command length');

  const shell = params.shell === 'cmd' ? 'cmd' : 'powershell';
  const timeoutMs = Math.max(1000, Math.min(Number(params.timeoutMs || 120_000), 3_600_000));
  const cwd = params.cwd ? path.resolve(String(params.cwd)) : undefined;

  if (cwd) {
    const stat = await fsp.stat(cwd);
    if (!stat.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
  }

  const exe = shell === 'cmd' ? 'cmd.exe' : 'powershell.exe';
  const args = shell === 'cmd'
    ? ['/d', '/s', '/c', command]
    : ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command];

  const startedAt = Date.now();
  const child = spawn(exe, args, {
    cwd,
    windowsHide: true,
    env: process.env
  });

  const stdout = [];
  const stderr = [];
  const stdoutState = { bytes: 0, truncated: false };
  const stderrState = { bytes: 0, truncated: false };

  child.stdout.on('data', (chunk) => appendLimited(stdout, chunk, stdoutState));
  child.stderr.on('data', (chunk) => appendLimited(stderr, chunk, stderrState));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.on('error', () => child.kill('SIGKILL'));
    } else {
      child.kill('SIGKILL');
    }
  }, timeoutMs);

  const result = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));

  return {
    exitCode: result.code,
    signal: result.signal,
    timedOut,
    durationMs: Date.now() - startedAt,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
    stdoutTruncated: stdoutState.truncated,
    stderrTruncated: stderrState.truncated
  };
}

async function systemInfo() {
  return {
    hostname: os.hostname(),
    username: os.userInfo().username,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    node: process.version,
    pid: process.pid,
    cwd: process.cwd()
  };
}

async function listDirectory(params) {
  const target = path.resolve(String(params.path || ''));
  const entries = await fsp.readdir(target, { withFileTypes: true });
  const out = [];
  for (const entry of entries.slice(0, 1000)) {
    let size = null;
    let mtime = null;
    try {
      const stat = await fsp.stat(path.join(target, entry.name));
      size = stat.size;
      mtime = stat.mtime.toISOString();
    } catch {}
    out.push({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      size,
      mtime
    });
  }
  return { path: target, entries: out, truncated: entries.length > 1000 };
}

async function readFile(params) {
  const target = path.resolve(String(params.path || ''));
  const maxBytes = Math.max(1, Math.min(Number(params.maxBytes || 262_144), 1_048_576));
  const handle = await fsp.open(target, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Not a file: ${target}`);
    const readBytes = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(readBytes);
    await handle.read(buffer, 0, readBytes, 0);
    return {
      path: target,
      size: stat.size,
      truncated: stat.size > maxBytes,
      content: buffer.toString('utf8')
    };
  } finally {
    await handle.close();
  }
}

async function dispatch(method, params) {
  switch (method) {
    case 'system_info':
      return systemInfo();
    case 'list_directory':
      return listDirectory(params);
    case 'read_file':
      return readFile(params);
    case 'execute':
      return executeCommand(params);
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

let shuttingDown = false;

function connect() {
  if (shuttingDown) return;
  console.log(`[client] connecting to ${HUB_WS_URL}`);

  const ws = new WebSocket(HUB_WS_URL, {
    headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
    handshakeTimeout: 15_000
  });

  ws.on('open', async () => {
    console.log('[client] connected');
    ws.send(JSON.stringify({
      type: 'hello',
      meta: {
        ...(await systemInfo()),
        execEnabled: EXEC_ENABLED,
        connectedAt: new Date().toISOString()
      }
    }));
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type !== 'request' || !msg.id) return;

    try {
      const result = await dispatch(msg.method, msg.params || {});
      ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'response',
        id: msg.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[client] disconnected code=${code} reason=${reason.toString()}`);
    if (!shuttingDown) setTimeout(connect, RECONNECT_MS);
  });

  ws.on('error', (error) => {
    console.error('[client] websocket error', error.message);
  });

  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 30_000);
  ws.on('close', () => clearInterval(pingTimer));
}

process.on('SIGINT', () => { shuttingDown = true; process.exit(0); });
process.on('SIGTERM', () => { shuttingDown = true; process.exit(0); });

connect();
