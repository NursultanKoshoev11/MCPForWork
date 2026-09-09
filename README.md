# MCPForWork

Private relay that exposes a Windows computer through an MCP server hosted on AWS.

## Architecture

`MCP host -> HTTPS Streamable HTTP -> AWS Hub -> authenticated WebSocket -> Windows Client`

The Windows machine opens the outbound WebSocket. No inbound port is required on the Windows PC.

## MCP tools

- `computer_status` - hub/agent connection state
- `computer_system_info` - read host information
- `computer_list_directory` - list a directory
- `computer_read_file` - read a text file
- `computer_execute` - execute PowerShell or CMD

## Security

- A random `AGENT_TOKEN` authenticates the Windows client to the AWS hub.
- A random `MCP_PATH_TOKEN` makes the MCP endpoint unguessable for the initial private deployment.
- Secrets are stored only in `.env` files and are ignored by Git.
- The hub container is limited to 384 MB RAM and 0.5 CPU.
- The Windows computer is never exposed with an inbound listening port.
- For production/multi-user use, replace the secret MCP URL with standards-based OAuth and explicit tool authorization.

## AWS

The hub runs in Docker and joins the existing `mobilechatserver_mobilechat` network so Caddy can reverse proxy it without publishing another EC2 port.

## Windows

Install dependencies:

```powershell
cd D:\MCPForWork\client
npm install
```

Start:

```powershell
powershell -ExecutionPolicy Bypass -File D:\MCPForWork\scripts\start-client.ps1
```

Install start-at-logon:

```powershell
powershell -ExecutionPolicy Bypass -File D:\MCPForWork\scripts\install-autostart.ps1
```

## End-to-end test

The test package connects using the official MCP client, lists tools, reads system info, and executes a harmless PowerShell command that prints `MCP_E2E_OK`.

## Production deployment

Current AWS host: `16.171.171.191`. The hub is deployed in `/home/ubuntu/MCPForWork` as `mcpforwork-hub` with `restart: unless-stopped`, 384 MB RAM and 0.5 CPU limits.

Caddy on the MobileChat Docker network proxies only these paths to the hub:

```caddy
handle /mcp-work/* {
    reverse_proxy mcpforwork-hub:3000
}

handle /mcp-agent {
    reverse_proxy mcpforwork-hub:3000
}
```

The fallback MobileChat route remains unchanged. Because its Caddyfile is mounted as a single bind-mounted file, if the host Caddyfile is replaced by rename, recreate only the Caddy container so it picks up the new inode:

```bash
cd /opt/projects/MobileChatServer
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate caddy
```

Do not commit `.env` files or print `AGENT_TOKEN` / `MCP_PATH_TOKEN` in logs.

### Windows autostart

The scheduled task is named `MCPForWork Client`. It runs at logon, ignores duplicate starts, restarts on failure, and is configured not to stop for battery/idle state.

### Verification

From `D:\MCPForWork\test`:

```powershell
npm run e2e
```

A successful run lists the MCP tools, reports `connected: true`, and returns `MCP_E2E_OK` from the remote Windows execution test.
