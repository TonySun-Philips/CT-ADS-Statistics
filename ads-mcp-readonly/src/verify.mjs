import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const configurationPath = process.argv.includes('--user')
  ? path.join(process.env.APPDATA, 'Code', 'User', 'mcp.json')
  : path.join(workspace, '.vscode', 'mcp.json');
const configuration = JSON.parse(await readFile(configurationPath, 'utf8'));
const server = configuration.servers['philips-azure-devops'];
assert(!Object.hasOwn(server.env, 'AZURE_DEVOPS_PAT'), 'PAT must not be stored in MCP configuration.');
assert(!Object.hasOwn(server.env, 'AZURE_DEVOPS_WRITE_PROJECT'), 'Write access must remain disabled.');
const localOnly = process.argv.includes('--local');
const serverArgs = server.args.map(argument => argument.replaceAll('${workspaceFolder}', workspace));
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === 'string')
);
Object.assign(environment, server.env);
if (localOnly) {
  environment.AZURE_DEVOPS_PAT = 'protocol-check-not-a-real-token';
  environment.AZURE_DEVOPS_URL = 'http://127.0.0.1:9/tfs';
}
const transport = new StdioClientTransport({
  command: server.command,
  args: localOnly ? [serverArgs[1]] : serverArgs,
  env: environment,
  stderr: 'pipe',
  cwd: workspace
});
transport.stderr?.on('data', () => {});
const client = new Client({ name: 'philips-ads-readonly-verifier', version: '1.0.0' });

async function callReadTool(name, argumentsValue = {}) {
  const result = await client.callTool(
    { name, arguments: argumentsValue }, undefined, { timeout: 30000 }
  );
  if (result.isError) {
    const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    const status = text.match(/\b(?:401|403|404|407|500|502|503|504)\b/)?.[0];
    throw new Error(`${name} failed${status ? ` (HTTP ${status})` : ''}; check ADS connectivity and permissions.`);
  }
  const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  return JSON.parse(text);
}

try {
  await client.connect(transport, { timeout: 15000 });
  const { tools } = await client.listTools(undefined, { timeout: 15000 });
  for (const required of ['test_connection', 'list_projects', 'query_work_items']) {
    assert(tools.some(tool => tool.name === required), `Missing tool: ${required}`);
  }
  assert(!tools.some(tool => /^(create|update|delete|set|save)_/.test(tool.name)), 'Unexpected write tool found.');
  console.log(`PASS: MCP initialize and tools/list (${tools.length} tools).`);

  if (localOnly) {
    console.log('LOCAL ONLY: no ADS request was made; authentication is not yet verified.');
  } else {
    const connection = await callReadTool('test_connection');
    if (connection.success !== true) {
      const status = String(connection.message).match(/\b(?:401|403|404|407|500|502|503|504)\b/)?.[0];
      throw new Error(`test_connection returned success=false${status ? ` (HTTP ${status})` : ''}.`);
    }
    console.log('PASS: test_connection.');
    const projects = await callReadTool('list_projects');
    assert(Array.isArray(projects) && projects.some(project => project.name === 'SY_CT_Projects'),
      'SY_CT_Projects was not returned by list_projects.');
    console.log('PASS: list_projects includes SY_CT_Projects.');
    const workItems = await callReadTool('query_work_items', {
      project: 'SY_CT_Projects',
      top: 5,
      wiql: "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.TeamProject] = 'SY_CT_Projects' ORDER BY [System.ChangedDate] DESC"
    });
    assert(Array.isArray(workItems) && workItems.length <= 5, 'Unexpected work item query result.');
    console.log(`PASS: read-only WIQL query (${workItems.length} work items).`);
    console.log('PASS: no write operations were requested.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.close();
}