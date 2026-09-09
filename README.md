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
