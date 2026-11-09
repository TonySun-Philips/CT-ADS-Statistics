# GitHub Copilot 异机搭建指南：Philips ADS

本指南供 GitHub Copilot 在另一台 Windows + VS Code 机器上，协助用户搭建与本仓库一致的 ADS 只读 MCP 和每日 Bug 报告环境。唯一来源是当前仓库代码和配置；不要照搬旧的可写 MCP 交接示例。

## 给 Copilot 的执行约定

- 先阅读本文件、[ADS 操作手册](ADS-操作手册.md)、根目录 `.vscode/mcp.json`、两个 `package.json` 与 README，再核对 Node、VS Code Profile、网络和工作区路径。
- 只配置 `philips-azure-devops` 只读服务。不要添加写工具、写入白名单或创建/修改/删除 ADS 内容。
- 不要求用户在聊天或终端命令中提供 PAT；不得读取、回显、记录或复制现有 PAT。请用户本人通过 VS Code `ADS: Save PAT Securely` 任务的遮蔽输入窗设置 token。若该任务不可用，停止在凭据步骤并请用户按公司批准流程设置，不要把 token 放入文件。
- 保留用户现有 MCP 配置、代理和设置，只合并 ADS 条目；不要覆盖其他服务器或更改执行策略、关闭 TLS 验证。
- 本机配置完成后分别验证工作区 MCP 和 VS Code 用户级 MCP。说明 `--local` 只测协议，不代表 ADS 连通。
- 执行每日真实报表或注册 Windows 计划任务前，先告知用户这会读取 ADS 工作项并在本机生成/安排报表；未经用户确认，不主动运行大量查询或注册计划任务。

## 环境和固定值

- Windows、VS Code Stable、PowerShell、Node.js 24.x（项目要求 `>=24 <25`）和 npm。
- ADS URL：`https://tfsemea1.ta.philips.com/tfs`
- Collection：`TPC_Region26`
- Project：`SY_CT_Projects`
- MCP 名称：`philips-azure-devops`
- 必须能够访问 ADS；PAT 由每台机器的当前用户提供，初始最小权限为 Work Items Read，并仍受 ADS 项目 ACL 约束。
- 两个 Node 项目都带 `package-lock.json`：`ads-mcp-readonly` 与 `ai-agent-harness`。

不要把 token、用户配置目录、`node_modules`、本机生成的 Excel 或用户身份文件复制到另一台机器。将仓库通过公司批准的 Git/文件渠道取得后，在新机器本地安装依赖。

## 1. 检查先决条件

在工作区根目录执行：

```powershell
node --version
npm.cmd --version
(Get-Command node.exe).Source
$env:APPDATA
```

Node 必须是 24.x。记录 `(Get-Command node.exe).Source`，后续配置使用完整路径。若命令找不到 Node，使用公司批准的软件渠道安装 Node 24，再重开终端。不得为了 npm 或证书问题关闭 TLS。

通过 VPN/公司网络确认 ADS 可访问；如 npm registry 需要代理，使用公司批准的代理和证书配置。不要覆盖用户现有 `NO_PROXY` 列表。launcher 会对子进程的 `NO_PROXY` / `no_proxy` 自动追加 `tfsemea1.ta.philips.com`。

## 2. 安装锁定依赖

从工作区根目录运行：

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ads-mcp-readonly' ci
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ai-agent-harness' ci
```

将命令中的 npm 路径替换成 Node 安装目录下实际的 `npm.cmd`。安装遇到网络问题时先诊断公司 registry/proxy/证书，不要删除锁文件后随意升级版本。确认 MCP launcher 语法：

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ads-mcp-readonly' run check
```

## 3. 由用户设置个人 PAT

PAT 必须由当前登录用户通过 VS Code 的 `Tasks: Run Task` 运行 `ADS: Save PAT Securely`，并在弹出的密码遮蔽窗口输入 ADS 实际 token。只保存于当前 Windows 用户环境变量 `AZURE_DEVOPS_PAT`。输入 token 时 Copilot 不得观察或处理其明文。

若任务提示 token 格式错误或验证失败，不要要求用户把 token 发到聊天。由用户在 ADS 检查 token 是否有效、是否有 Work Items Read scope、当前账号是否有项目读取权限，并在需要时通过遮蔽窗口轮换。用户级环境变量不是加密密钥库，必须符合公司凭据政策。

## 4. 配置工作区 MCP

`.vscode/mcp.json` 是 VS Code 工作区 MCP 定义。合并以下 `philips-azure-devops` 项，不要覆盖已经存在的其他 server。把 `command` 改为本机 `node.exe` 的绝对路径；`args` 使用当前工作区绝对路径。JSON 中反斜杠需写成双反斜杠：

```json
{
  "servers": {
    "philips-azure-devops": {
      "type": "stdio",
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\PATH\\TO\\ADS\\ads-mcp-readonly\\src\\launcher.cjs",
        "C:\\PATH\\TO\\ADS\\ads-mcp-readonly\\node_modules\\azure-devops-mcp\\dist\\index.js"
      ],
      "env": {
        "NODE_USE_SYSTEM_CA": "1",
        "AZURE_DEVOPS_URL": "https://tfsemea1.ta.philips.com/tfs",
        "AZURE_DEVOPS_COLLECTION": "TPC_Region26",
        "AZURE_DEVOPS_PROJECT": "SY_CT_Projects"
      }
    }
  }
}
```

不要在 `env` 写 `AZURE_DEVOPS_PAT`。当前仓库配置使用 `${workspaceFolder}`，在原工作区可沿用；复制成用户级配置时请用绝对路径，避免该变量不能解析。

保存后，在 VS Code 中打开命令面板，运行 `MCP: List Servers`，启动 `philips-azure-devops`。若提示 Workspace Trust 或 MCP 启动授权，检查配置后由用户确认。

## 5. 配置用户级 MCP（日报所需）

日报 runner 和计划任务明确从 VS Code Stable 用户级 `%APPDATA%\Code\User\mcp.json` 读取 `servers.philips-azure-devops`。仅有工作区 `.vscode/mcp.json` 时，日报不能保证找到 server。

在 VS Code 命令面板运行 `MCP: Open User Configuration`（若命令名称在当前版本不同，则使用 MCP 配置相关命令打开实际用户配置），将同一个 server 条目合并到用户级 `servers`，其中 `command` 和两条 `args` 必须是本机绝对路径。保留文件中的其他 MCP 项；PAT 仍不进入文件。VS Code Insiders 或非 Stable Profile 的路径不同，先确认 runner 当前固定读取的位置；如要改成其他 Profile，需同步修改并测试 runner 与计划任务，不能只改 MCP 配置。

## 6. 验收

先验证本地协议，不访问 ADS：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ads-mcp-readonly\src\verify.mjs' --local
```

再验证真实 ADS 只读连接：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ads-mcp-readonly\src\verify.mjs'
```

第二条请求连接测试、项目列表和最多 5 条 `SY_CT_Projects` 工作项，不执行写入。通过后，再在 VS Code MCP 列表确认宿主实例启动；Copilot 对话中可要求调用 `test_connection` 和 `list_projects`。Standalone 验收成功不能代替宿主验证。

测试日报代码（只运行本地单元测试，不访问 ADS）：

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ai-agent-harness' test
```

实际运行日报会访问 ADS、读取工作项并生成带工作项内容的 Excel；先取得用户确认，再执行：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\src\run-bug-status.mjs'
```

成功文件位于 `ai-agent-harness/evals/reports/daily-bugs/`，失败诊断位于 `ai-agent-harness/evals/reports/logs/`。报告含敏感业务数据，默认仅本地保存。

## 7. 可选：设置每日计划任务

只有用户明确要求后才注册。任务使用当前用户的交互式登录令牌，每天运行时该用户须已登录。默认从明天起每天本地时间 08:00：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\scripts\register-daily-task.mjs'
```

改为 09:30：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\scripts\register-daily-task.mjs' --time 09:30
```

确认任务可用后，Windows Task Scheduler 中任务名为 `Philips ADS Daily Bug Status Agent`。移除：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\scripts\register-daily-task.mjs' --remove
```

脚本不覆盖同名现有任务。注册前若任务已存在，应先向用户说明并确认是否移除/重建。

## 8. 常见问题

- `AZURE_DEVOPS_PAT is not configured at user scope`：确认在运行 MCP 的同一 Windows 用户下完成安全输入，然后重启 MCP。
- HTTP 401：检查 token 有效期和 scope；不要在聊天中索要 token。
- HTTP 403：检查 ADS 项目权限，也可能是 token scope 不足。
- npm 安装超时：检查公司网络、npm registry/proxy 和证书信任；不要关闭 TLS 或清除既有代理设置。
- `MODULE_NOT_FOUND`：核对 Node 绝对路径、工作区路径、`args` 指向的文件及 `npm ci` 是否成功。
- 工作区验证成功但日报失败：检查 Stable 的用户级 `%APPDATA%\Code\User\mcp.json` 是否有相同 server，并核对绝对路径和当前账户环境变量。
- `--local` 成功但真实验证失败：本地协议正常；继续排查 ADS 网络、PAT 和项目 ACL。
- MCP 显示 Running 但工具不可用：查看 MCP 日志/stderr，并在实际 Copilot 宿主中验证，不以进程状态作为认证证据。

## 搭建完成条件

- Node 24.x，两个项目的 `npm ci` 和测试通过。
- PAT 由用户本人安全输入，配置文件和聊天中没有 PAT。
- 工作区和 Stable 用户级配置均有只读 `philips-azure-devops` 条目，路径属于当前机器。
- 本地协议检查、有限 ADS 只读验收和 VS Code 宿主验证均成功。
- 未启用任何 ADS 写访问；日报和计划任务仅在用户确认后运行/注册。
