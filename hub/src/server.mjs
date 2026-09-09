import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';

const PORT = Number(process.env.PORT || 3000);
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const MCP_PATH_TOKEN = process.env.MCP_PATH_TOKEN;
const AGENT_PATH = '/mcp-agent';
const MCP_PATH = `/mcp-work/${MCP_PATH_TOKEN || 'missing-token'}`;
const DEFAULT_TIMEOUT_MS = 120_000;

if (!AGENT_TOKEN || AGENT_TOKEN.length < 24) {
  throw new Error('AGENT_TOKEN is required and must be at least 24 characters');
}
if (!MCP_PATH_TOKEN || MCP_PATH_TOKEN.length < 24) {
  throw new Error('MCP_PATH_TOKEN is required and must be at least 24 characters');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

let agent = null;
let agentMeta = null;
const pending = new Map();

function textResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
  };
}

function rejectPending(reason) {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }
  pending.clear();
}

function sendToAgent(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!agent || agent.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Windows agent is not connected'));
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Agent request timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    agent.send(JSON.stringify({ type: 'request', id, method, params }));
  });
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== AGENT_PATH) {
    socket.destroy();
    return;
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${AGENT_TOKEN}`) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  if (agent && agent.readyState === WebSocket.OPEN) {
    agent.close(4001, 'Replaced by a newer agent connection');
  }
  agent = ws;
  agentMeta = null;
  console.log('[agent] connected');

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'hello') {
        agentMeta = msg.meta || null;
        console.log('[agent] hello', agentMeta);
        return;
      }
      if (msg.type === 'response' && msg.id) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error || 'Agent request failed'));
      }
    } catch (error) {
      console.error('[agent] invalid message', error);
    }
  });

  ws.on('close', () => {
    if (agent === ws) {
      agent = null;
      agentMeta = null;
      rejectPending('Windows agent disconnected');
    }
    console.log('[agent] disconnected');
  });

  ws.on('error', (error) => console.error('[agent] websocket error', error));
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mcpforwork-hub',
    agentConnected: !!agent && agent.readyState === WebSocket.OPEN,
    agent: agentMeta,
    pendingRequests: pending.size
  });
});

const mcpHandler = createMcpHandler(() => {
  const mcp = new McpServer(
    { name: 'mcpforwork-computer', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  mcp.registerTool(
    'computer_status',
    {
      description: 'Return whether the Windows computer agent is connected and basic agent metadata.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => textResult({
      connected: !!agent && agent.readyState === WebSocket.OPEN,
      agent: agentMeta
    })
  );

  mcp.registerTool(
    'computer_system_info',
    {
      description: 'Read basic operating-system, host, user, CPU, memory, and Node.js information from the connected Windows computer.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try {
        return textResult(await sendToAgent('system_info', {}));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  mcp.registerTool(
    'computer_list_directory',
    {
      description: 'List files and folders in a directory on the connected Windows computer.',
      inputSchema: z.object({
        path: z.string().min(1).max(1000)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ path }) => {
      try {
        return textResult(await sendToAgent('list_directory', { path }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  mcp.registerTool(
    'computer_read_file',
    {
      description: 'Read a UTF-8 text file from the connected Windows computer. Large files are truncated to maxBytes.',
      inputSchema: z.object({
        path: z.string().min(1).max(1000),
        maxBytes: z.number().int().min(1).max(1_048_576).default(262_144)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ path, maxBytes }) => {
      try {
        return textResult(await sendToAgent('read_file', { path, maxBytes }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  mcp.registerTool(
    'computer_execute',
    {
      description: 'Execute a PowerShell or CMD command on the connected Windows computer and return exit code, stdout and stderr.',
      inputSchema: z.object({
        command: z.string().min(1).max(20_000),
        shell: z.enum(['powershell', 'cmd']).default('powershell'),
        cwd: z.string().max(1000).optional(),
        timeoutSeconds: z.number().int().min(1).max(3600).default(120)
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ command, shell, cwd, timeoutSeconds }) => {
      try {
        return textResult(await sendToAgent(
          'execute',
          { command, shell, cwd, timeoutMs: timeoutSeconds * 1000 },
          timeoutSeconds * 1000 + 10_000
        ));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return mcp;
});

app.all(MCP_PATH, toNodeHandler(mcpHandler));

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[hub] listening on :${PORT}`);
  console.log(`[hub] MCP endpoint /mcp-work/<secret>`);
  console.log(`[hub] agent websocket ${AGENT_PATH}`);
});

