import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = path.resolve(harnessRoot, '..');
const taskName = 'Philips ADS Daily Bug Status Agent';
const args = process.argv.slice(2);

function runScheduledTasks(args) {
  return execFileSync('schtasks.exe', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

if (args.includes('--remove')) {
  try {
    runScheduledTasks(['/Delete', '/TN', taskName, '/F']);
    console.log(`Removed scheduled task: ${taskName}`);
  } catch (error) {
    const detail = error.stderr?.toString() || '';
    if (/cannot find|does not exist|cannot find the file/i.test(detail)) {
      console.log('Scheduled task was not present.');
    } else {
      throw new Error('Could not remove the scheduled task. Check Task Scheduler permissions.');
    }
  }
  process.exit(0);
}

const timeArgumentIndex = args.indexOf('--time');
const runTime = timeArgumentIndex >= 0 ? args[timeArgumentIndex + 1] : '08:00';
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(runTime || '')) {
  throw new Error('Supply daily time in local 24-hour HH:mm format, for example --time 08:00.');
}

let account;
try {
  account = execFileSync('whoami.exe', [], { encoding: 'utf8', windowsHide: true }).trim();
} catch {
  throw new Error('Could not determine the current Windows user account.');
}
if (!account) throw new Error('Current Windows user account is empty.');

let mcpConfig;
try {
  mcpConfig = JSON.parse(await readFile(path.join(process.env.APPDATA, 'Code', 'User', 'mcp.json'), 'utf8'));
} catch {
  throw new Error('Could not read the VS Code user MCP configuration.');
}
const mcpServer = mcpConfig.servers?.['philips-azure-devops'];
if (!mcpServer?.command || !Array.isArray(mcpServer.args)) {
  throw new Error('philips-azure-devops is not configured in the VS Code user MCP configuration.');
}

try {
  runScheduledTasks(['/Query', '/TN', taskName]);
  throw new Error(`Task already exists (${taskName}); remove it explicitly before replacing it.`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith('Task already exists')) throw error;
}

function xmlEscape(value) {
  return String(value).replace(/[<>&"']/g, character => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;'
  })[character]);
}

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const startDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
const [hour, minute] = runTime.split(':').map(Number);
const startBoundary = `${startDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
const nodePath = mcpServer.command;
const runnerPath = path.join(harnessRoot, 'src', 'run-bug-status.mjs');
const definition = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Runs the read-only Philips ADS daily Bug status agent. No ADS writes or external report delivery.</Description><URI>${taskName}</URI></RegistrationInfo>
  <Triggers><CalendarTrigger><StartBoundary>${startBoundary}</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${xmlEscape(account)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled><ExecutionTimeLimit>PT15M</ExecutionTimeLimit><Priority>7</Priority></Settings>
  <Actions Context="Author"><Exec><Command>${xmlEscape(nodePath)}</Command><Arguments>&quot;${xmlEscape(runnerPath)}&quot;</Arguments><WorkingDirectory>${xmlEscape(workspaceRoot)}</WorkingDirectory></Exec></Actions>
</Task>
`;

const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'ads-bug-agent-'));
const definitionPath = path.join(tempDirectory, 'task.xml');
try {
  await writeFile(definitionPath, Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(definition, 'utf16le')
  ]));
  runScheduledTasks(['/Create', '/TN', taskName, '/XML', definitionPath]);
  console.log(`Registered daily Bug status task for ${runTime} local time.`);
  console.log(`Task: ${taskName}`);
  console.log(`First scheduled date: ${startDate}`);
  console.log('Runs only while this Windows user is signed in; missed runs start when available.');
} catch (error) {
  const detail = error.stderr?.toString().trim();
  throw new Error(`Could not register the daily task.${detail ? ` Task Scheduler: ${detail}` : ' Check Task Scheduler permissions and ensure a task with the same name does not already exist.'}`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
