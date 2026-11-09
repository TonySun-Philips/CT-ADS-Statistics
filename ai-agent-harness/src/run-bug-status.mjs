import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createXlsxReport } from './xlsx-report.mjs';
import { collectAllIdPages } from './query-paging.mjs';

const harnessRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = path.resolve(harnessRoot, '..');
const requireFromAdsMcp = createRequire(path.join(workspaceRoot, 'ads-mcp-readonly', 'package.json'));
const sdkClientPath = requireFromAdsMcp.resolve('@modelcontextprotocol/sdk/client/index.js');
const sdkTransportPath = requireFromAdsMcp.resolve('@modelcontextprotocol/sdk/client/stdio.js');
const [{ Client }, { StdioClientTransport }] = await Promise.all([
  import(pathToFileURL(sdkClientPath).href),
  import(pathToFileURL(sdkTransportPath).href)
]);

const taskPath = path.resolve(
  harnessRoot,
  process.argv[2] || 'agents/tasks/daily-bug-status.json'
);
const task = JSON.parse(await readFile(taskPath, 'utf8'));
assert(task.mcpServer && task.project && task.workItemType === 'Bug', 'Task must select an MCP server, project, and Bug type.');
assert(task.everAssignedTo && /^\d{4}-\d{2}-\d{2}$/.test(task.startDate), 'Task must specify a historical assignee and start date.');
assert(Number.isInteger(task.pageSize) && task.pageSize > 0 && task.pageSize <= 200, 'Task pageSize must be between 1 and 200.');

const userMcpPath = path.join(process.env.APPDATA, 'Code', 'User', 'mcp.json');
const userMcp = JSON.parse(await readFile(userMcpPath, 'utf8'));
const server = userMcp.servers?.[task.mcpServer];
assert(server?.type === 'stdio', `MCP stdio server not found: ${task.mcpServer}`);
assert(!Object.hasOwn(server.env || {}, 'AZURE_DEVOPS_PAT'), 'PAT must not be stored in MCP configuration.');
assert(!Object.hasOwn(server.env || {}, 'AZURE_DEVOPS_WRITE_PROJECT'), 'Write access must remain disabled.');

const serverArgs = server.args.map(argument => argument.replaceAll('${workspaceFolder}', workspaceRoot));
const transport = new StdioClientTransport({
  command: server.command,
  args: serverArgs,
  env: { ...process.env, ...server.env },
  stderr: 'pipe',
  cwd: workspaceRoot
});
transport.stderr?.on('data', () => {});
const client = new Client({ name: 'philips-ads-daily-bug-status', version: '1.0.0' });

function parseToolResult(result, toolName) {
  const text = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
  if (result.isError) {
    throw new Error(`${toolName} failed: ${text.slice(0, 1000)}`);
  }
  return JSON.parse(text);
}

function localDateStamp(now) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const reportDirectory = path.resolve(harnessRoot, task.reportDirectory);
const now = new Date();
const dateStamp = localDateStamp(now);
let connected = false;

function dateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function nextDate(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

try {
  await client.connect(transport, { timeout: 20000 });
  const { tools } = await client.listTools(undefined, { timeout: 15000 });
  const availableTools = new Set(tools.map(tool => tool.name));
  for (const required of ['test_connection', 'query_work_items']) {
    assert(availableTools.has(required), `MCP tool is not available: ${required}`);
  }

  const connection = parseToolResult(
    await client.callTool({ name: 'test_connection', arguments: {} }, undefined, { timeout: 60000 }),
    'test_connection'
  );
  assert(connection.success === true, 'ADS connection check did not succeed.');
  connected = true;

  const workItems = [];
  let queryRequestCount = 0;
  const dates = dateRange(task.startDate, dateStamp);
  for (const date of dates) {
    const { items: dailyWorkItems, requestCount } = await collectAllIdPages(async (afterId, pageSize) => {
      const wiql = [
        'SELECT [System.Id], [System.Title], [System.State], [System.Tags], [System.CreatedDate]',
        'FROM WorkItems',
        `WHERE [System.TeamProject] = '${task.project}' AND [System.WorkItemType] = '${task.workItemType}'`,
        `AND EVER [System.AssignedTo] = '${task.everAssignedTo.replaceAll("'", "''")}'`,
        `AND [System.CreatedDate] >= '${date}' AND [System.CreatedDate] < '${nextDate(date)}'`,
        `AND [System.Id] > ${afterId}`,
        'ORDER BY [System.Id] ASC'
      ].join(' ');
      const result = parseToolResult(
        await client.callTool({
          name: 'query_work_items',
          arguments: { project: task.project, wiql, top: pageSize }
        }, undefined, { timeout: 60000 }),
        `query_work_items for ${date} after ID ${afterId}`
      );
      assert(Array.isArray(result), `ADS returned an unexpected result for ${date}.`);
      return result;
    }, task.pageSize);
    workItems.push(...dailyWorkItems);
    queryRequestCount += requestCount;
  }

  const { outputPath, overall } = await createXlsxReport(workItems, task, now, queryRequestCount);
  console.log(`PASS: ADS connection (${connection.responseTimeMs} ms).`);
  console.log(`PASS: read ${workItems.length} Bugs created from ${task.startDate} through ${dateStamp}, with no daily result cap.`);
  console.log(`PASS: ${Object.keys(overall).length} Resolution categories across ${queryRequestCount} ADS page requests (up to ${task.pageSize} IDs per request).`);
  console.log(`Excel report saved locally: ${outputPath}`);
  console.log('No ADS data was modified.');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const logDirectory = path.join(harnessRoot, 'evals', 'reports', 'logs');
  await mkdir(logDirectory, { recursive: true });
  await writeFile(path.join(logDirectory, `${dateStamp}.log`), `${now.toISOString()}\nADS connected: ${connected}\n${message}\n`, 'utf8');
  console.error(`Daily Bug Status failed. See local log: ${path.join(logDirectory, `${dateStamp}.log`)}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
