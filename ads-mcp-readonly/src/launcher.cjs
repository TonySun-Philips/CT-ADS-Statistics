const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
  );
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$values = @{',
    'AZURE_DEVOPS_PAT = [Environment]::GetEnvironmentVariable("AZURE_DEVOPS_PAT", "User");',
    'NO_PROXY = [Environment]::GetEnvironmentVariable("NO_PROXY", "User")',
    '}',
    'ConvertTo-Json -Compress -InputObject $values'
  ].join('\n');
  let userEnvironment;
  try {
    userEnvironment = JSON.parse(execFileSync(powershell, [
      '-NoProfile', '-NonInteractive', '-Command', script
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe']
    }));
  } catch {
    throw new Error('Unable to read the current Windows user environment.');
  }

  const pat = userEnvironment.AZURE_DEVOPS_PAT;
  if (typeof pat !== 'string' || !pat.trim()) {
    throw new Error('AZURE_DEVOPS_PAT is not configured at user scope.');
  }
  if (/\s/.test(pat)) {
    throw new Error('AZURE_DEVOPS_PAT contains whitespace; enter the token value, not a command.');
  }
  process.env.AZURE_DEVOPS_PAT = pat;
  const bypassEntries = new Set([
    ...(process.env.NO_PROXY || '').split(','),
    ...(userEnvironment.NO_PROXY || '').split(','),
    'tfsemea1.ta.philips.com'
  ].map(entry => entry.trim()).filter(Boolean));
  process.env.NO_PROXY = [...bypassEntries].join(',');
  process.env.no_proxy = process.env.NO_PROXY;

  const entryPoint = process.argv[2] || path.join(
    __dirname, '..', 'node_modules', 'azure-devops-mcp', 'dist', 'index.js'
  );
  await import(pathToFileURL(entryPoint).href);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});