# Philips ADS 操作手册

适用范围：本工作区的 Philips Azure DevOps Server（ADS）只读 MCP 与每日 Bug 状态 Excel 报告。新机器安装请按[Copilot 异机搭建指南](Copilot-异机搭建指南.md)操作。

## 当前架构

- ADS 地址：`https://tfsemea1.ta.philips.com/tfs`
- Collection：`TPC_Region26`
- 默认项目：`SY_CT_Projects`（ADS 是服务简称，不是项目名）
- MCP：工作区 `.vscode/mcp.json` 启动本地 Node stdio 进程，实际服务为 `azure-devops-mcp@1.1.2`，只读。
- 凭据：launcher 每次启动时读取当前 Windows 用户级 `AZURE_DEVOPS_PAT`，并为 ADS 主机补充代理绕过；PAT 不保存在 MCP 配置中。
- 日报：`ai-agent-harness` 通过 VS Code 用户级 `philips-azure-devops` 配置查询 ADS，生成本地 Excel。

当前交付是只读配置。不要从旧文档恢复 `azure-devops-mcp-write`、写入白名单或写工具；初始 PAT 只需 Work Items Read。用户权限仍由 ADS 项目 ACL 控制。

## 首次设置与验证

按[Copilot 异机搭建指南](Copilot-异机搭建指南.md)完成 Node、依赖、PAT 和两个 MCP 配置的准备。完成后从 VS Code 命令面板运行 `MCP: List Servers`，选择 `philips-azure-devops` 并启动或重启。

在工作区 PowerShell 中运行只读验收：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ads-mcp-readonly\src\verify.mjs' --local
& 'C:\Program Files\nodejs\node.exe' '.\ads-mcp-readonly\src\verify.mjs'
```

第一条只验证本地 MCP 初始化和工具发现，不访问 ADS，也不验证 PAT。第二条执行有限的真实只读检查：`test_connection`、项目列表和最多 5 条工作项查询。若 Node 安装路径不同，请替换命令中的路径。

真实连接成功后，VS Code 中还应确认 MCP 已启动。在 Copilot 对话里可以要求调用 `test_connection`、`list_projects`，再对 `SY_CT_Projects` 发起受限只读 WIQL。工具显示或服务器显示 Running，不代表认证或网络请求已成功。不要在验收时要求创建、修改或删除 ADS 数据。

## 使用每日 Bug 报告

报告规则由 `ai-agent-harness/agents/tasks/daily-bug-status.json` 定义：项目 `SY_CT_Projects` 中，自 `2026-10-08` 至运行当天（本机日期）创建、曾经分配给 `GAO, Hai Tao` 的 Bug。查询按创建日期分区，并以递增工作项 ID 分页；每次请求最多 200 条，没有每日结果上限。

运行前确认 VS Code Stable 用户级 `%APPDATA%\Code\User\mcp.json` 中有 `philips-azure-devops`，因为日报 runner 使用该配置，而非只使用工作区 MCP 配置。然后在工作区根目录运行：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\src\run-bug-status.mjs'
```

Excel 输出到 `ai-agent-harness/evals/reports/daily-bugs/YYYY-MM-DD.xlsx`，仅保存在本机且被 Git 忽略。工作表包括：

- `RawData`：创建日期、ID、标题、状态、标签。
- `Resolution`：源字段加派生分类。
- `每日Issue统计`：按日创建总数和各 Resolution 分类数。
- `Daily`：总览、逐日数据、带数据表和数值标签的创建量折线图，以及带数据表、日期标签斜排的 Resolution 堆叠柱形图。图表颜色和 X 轴格式固定，后续每次报告生成保持一致。

分类规则和字段解释详见[日报 Agent 说明](../ai-agent-harness/agents/bug-status-agent.md)。失败日志写入 `ai-agent-harness/evals/reports/logs/`；日志不应包含 PAT。工作项标题、标签和报表内容属于 ADS 数据，不要未经审查就外发或提交到版本库。

## 自动定时运行

在工作区根目录注册每天本地时间 08:00 的任务，从明天开始：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\scripts\register-daily-task.mjs'
```

指定其他时间（24 小时制）：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\scripts\register-daily-task.mjs' --time 09:30
```

计划任务名为 `Philips ADS Daily Bug Status Agent`。它以当前用户最低权限和交互式登录令牌运行，因此该用户必须已登录，用户级 PAT 才可用；错过的运行会在任务可用时启动。若同名任务已存在，脚本不会覆盖它。移除任务：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\scripts\register-daily-task.mjs' --remove
```

变更工作区位置或 Node 路径后，重新检查计划任务定义并重新注册。可在 Windows Task Scheduler 中查看任务状态、最近结果和下次运行时间。

## 测试与常用检查

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ads-mcp-readonly' run check
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ai-agent-harness' test
```

如需重新安装依赖，在各项目目录有锁文件时使用 `npm.cmd ci`：

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ads-mcp-readonly' ci
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ai-agent-harness' ci
```

PowerShell 使用 `npm.cmd` 可避免执行策略拦截 `npm.ps1`。若公司网络需要代理，使用公司批准的 npm registry/proxy 和证书链；不要关闭 TLS 校验。

## 排错顺序

1. 核对运行身份、Node 绝对路径、依赖是否安装，以及 MCP 实际加载的配置文件。
2. 查看 MCP 的 stderr / VS Code MCP 日志，先解决入口路径、Node 版本或缺失依赖问题。
3. 用 `verify.mjs --local` 检查本地协议；它不证明 ADS 认证成功。
4. 运行不带参数的 `verify.mjs` 检查 ADS 网络、PAT 和项目读取权限。
5. 401 通常需核对 PAT 有效期和 scope；403 也可能是项目 ACL，不一定是 PAT 本身。
6. 代理或 TLS 错误应检查 VPN、公司代理绕过及系统证书信任。不要设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`。
7. 确认 MCP 使用当前 Windows 用户后，再重启服务器；必要时 Reload Window。不要因连接失败反复创建 PAT。

PAT 由用户本人通过 VS Code 任务 `ADS: Save PAT Securely` 的遮蔽输入窗设置。只在该窗输入实际 token；不要将 PAT 发给 Copilot、粘贴到命令行、配置、日志或截图。Windows 用户级环境变量不是加密密钥库，须遵循公司凭据政策，并在轮换后重启 MCP。