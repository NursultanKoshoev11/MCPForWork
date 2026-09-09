import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const MCP_URL = process.env.MCP_URL;
if (!MCP_URL) throw new Error('MCP_URL is required');

const client = new Client({ name: 'mcpforwork-e2e', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
  versionNegotiation: { mode: 'auto' }
});

await client.connect(transport);

const tools = await client.listTools();
console.log('TOOLS', tools.tools.map((t) => t.name).join(','));

const status = await client.callTool({ name: 'computer_status', arguments: {} });
console.log('STATUS', JSON.stringify(status));

const info = await client.callTool({ name: 'computer_system_info', arguments: {} });
console.log('SYSTEM_INFO', JSON.stringify(info));

const exec = await client.callTool({
  name: 'computer_execute',
  arguments: {
    shell: 'powershell',
    command: "Write-Output 'MCP_E2E_OK'; hostname; whoami",
    timeoutSeconds: 30
  }
});
console.log('EXEC', JSON.stringify(exec));

await transport.close();
