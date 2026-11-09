# AI Agent Harness

A provider-neutral home for building, testing, and evaluating AI agents.

For Philips ADS environment setup and daily operations, see the workspace [ADS operator runbook](../docs/ADS-操作手册.md)
and the [Copilot setup guide for another machine](../docs/Copilot-异机搭建指南.md).

## Layout

```text
.github/workflows/  CI workflows for lint, tests, and evaluations
agents/             Agent definitions and orchestration
prompts/            Versioned system/task prompts
tools/              Tool adapters and schemas
src/                Shared runtime and harness implementation
tests/unit/          Fast isolated tests
tests/integration/  Tests against local or explicitly approved services
evals/cases/        Versioned evaluation scenarios and expected behavior
evals/datasets/     Small, reviewed evaluation datasets
evals/fixtures/     Deterministic tool/model response fixtures
evals/reports/      Local evaluation output; do not commit sensitive results
config/             Non-secret environment and run configuration
scripts/            Local developer commands
docs/               Design notes, architecture, and runbooks
```

## Suggested boundaries

- Keep prompts and evaluation cases versioned and reviewable.
- Put provider-specific code behind adapters in `tools/` or `src/`.
- Use fixtures for deterministic tests; integration tests must make external access explicit.
- Load API keys from an approved secret store or environment variables. Never commit secrets, `.env` files, or raw sensitive evaluation data.
- Keep generated reports out of Git unless they have been reviewed and sanitized.

## ADS Bug Status Agent

This workspace includes a deterministic, read-only daily status agent for Philips ADS. It does not call an external LLM: it queries historical assignment and creation-date filters, classifies Bug states, and builds an Excel report.

- Agent instructions: [agents/bug-status-agent.md](agents/bug-status-agent.md)
- Editable task definition: [agents/tasks/daily-bug-status.json](agents/tasks/daily-bug-status.json)
- Daily report runner: [src/run-bug-status.mjs](src/run-bug-status.mjs)
- Windows schedule registration: [scripts/register-daily-task.mjs](scripts/register-daily-task.mjs)
- Local reports: `evals/reports/daily-bugs/` (Excel; ignored by Git)
- Run logs on failure: `evals/reports/logs/` (ignored by Git)

Install the Excel report dependencies once, then run from the workspace root:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --prefix '.\ai-agent-harness' install
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\src\run-bug-status.mjs'
```

Register the Windows task for 08:00 local time, beginning tomorrow:

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\scripts\register-daily-task.mjs'
```

Choose a different time with `--time HH:mm`, for example `--time 09:30`. The task uses the current Windows user with an interactive logon, so the user must be signed in; missed runs start when the task becomes available. Find `Philips ADS Daily Bug Status Agent` in Task Scheduler. Remove it with:

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\scripts\register-daily-task.mjs' --remove
```

The runner reads the server definition from `%APPDATA%\Code\User\mcp.json`; the launcher loads PAT and `NO_PROXY` from the current user's environment at process start. The task definition contains no secret. Each day is queried from 2026-10-08 through the run date for Bugs ever assigned to `GAO, Hai Tao`, with no daily result cap. Results are paged by increasing work-item ID; each request stays within ADS's 200-ID batch-detail limit. The current MCP accepts WIQL, not a saved Query name, so the agent implements the specified filters rather than executing a saved Query. Reports include work-item details, stay local, and are excluded from Git.
