# Philips ADS 日常操作入口

完整的人工操作说明（连接验证、只读查询、日报运行、定时任务和排错）见[ADS 操作手册](./ADS-操作手册.md)。

在工作区根目录手动生成每日 Bug Excel 报告：

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\src\run-bug-status.mjs'
```

新机器搭建请使用[GitHub Copilot 异机搭建指南](./Copilot-异机搭建指南.md)。运行日报会读取 ADS 工作项并在本机生成含业务数据的 Excel。