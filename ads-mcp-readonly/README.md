# Philips ADS Read-Only MCP

This read-only MCP uses `azure-devops-mcp@1.1.2` from
https://github.com/elad-nofy/azure-devops-mcp and the installed Node 24 LTS.
Keep `package-lock.json` for reproducible dependency installation.

VS Code configuration: [../.vscode/mcp.json](../.vscode/mcp.json).
The server name is `philips-azure-devops`. No SDK-specific `.mcp.json` is created.

For setup and operations, see the [human-readable ADS runbook](../docs/ADS-操作手册.md)
and the [Copilot setup guide for another machine](../docs/Copilot-异机搭建指南.md).
The launcher reads `AZURE_DEVOPS_PAT` and `NO_PROXY` from the current Windows
user environment on every start. Configure or rotate your own PAT using
the [Copilot setup guide](../docs/Copilot-异机搭建指南.md), then restart the
MCP server. Never store a PAT in a configuration file or send it in chat.
User environment variables are not an encrypted credential vault.

Initial PAT scope: Work Items Read. Grant other read scopes only when needed.
No custom Query, Dashboard, or Widget write extension is installed.
Windows system certificate trust is enabled; TLS verification stays enabled.

From the workspace root in PowerShell:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ads-mcp-readonly' run check
& 'C:\Program Files\nodejs\node.exe' '.\ads-mcp-readonly\src\verify.mjs' --local
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ads-mcp-readonly' run verify
```

`--local` only checks MCP initialization and tool discovery with a fake token
and a loopback URL. It does not prove ADS authentication or network access.
The default verifier uses the configured launcher and performs only
`test_connection`, `list_projects`, and a WIQL query for at most five work items
in `SY_CT_Projects`. It reports counts rather than work item contents.

In VS Code, run `MCP: List Servers`, select `philips-azure-devops`, and start
or restart it. Approve workspace trust and MCP startup only after reviewing
the configuration. Verify ADS access in the actual Copilot conversation too;
the standalone check does not prove the host has started its own MCP process.