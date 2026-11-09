# ADS 配置文档入口

当前实现和操作步骤已整理到以下文档：

- [人类操作手册](docs/ADS-操作手册.md)：连接验收、只读查询、每日 Bug Excel、计划任务、排错。
- [GitHub Copilot 异机搭建指南](docs/Copilot-异机搭建指南.md)：新 Windows 机器的环境配置、凭据边界、MCP 配置和验收清单。

## 当前实现说明

仓库当前使用 `ads-mcp-readonly` 中的 `azure-devops-mcp@1.1.2` 只读 MCP。PAT 由本机 Windows 用户自行配置，不能放进仓库或 MCP JSON。日报工具从 VS Code Stable 用户级 MCP 配置读取 server，并在用户确认后查询 ADS 和写入本地 Excel。

此入口替代旧版交接说明。旧版提及的本地 `azure-devops-mcp-write` 扩展、Query/Dashboard 写工具、`AZURE_DEVOPS_WRITE_PROJECT` 与相关安装路径不属于当前交付，不要在新机器上按旧样例配置。

请以仓库中的 `.vscode/mcp.json`、`ads-mcp-readonly/README.md`、`ai-agent-harness/README.md` 和上述两份文档为准。若本说明与代码不一致，先核实当前分支实现，不要猜测。