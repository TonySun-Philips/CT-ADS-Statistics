# Daily ADS Bug Status Agent

## Goal and query scope

Create a daily, read-only Excel snapshot for Philips ADS project `SY_CT_Projects`.

- Include Bugs created from `2026-10-08` through the local run date, inclusive.
- Include a Bug if it was ever assigned to `GAO, Hai Tao` (`EVER [System.AssignedTo]`).
- Return `Created Date`, `ID`, `Title`, `State`, and `Tags`.
- Query one creation-date partition at a time and fetch all matching records; there is no per-day result cap.
- Use `pageSize` from `tasks/daily-bug-status.json` for each MCP request (maximum 200 because ADS work-item detail batches support at most 200 IDs).
- Continue with `System.Id > lastId` until a page contains fewer than `pageSize` results; reject repeated or out-of-order IDs rather than silently dropping data.

The current MCP exposes WIQL but does not execute a saved Query by name. The agent therefore implements the specified historical-assignee and date filters in WIQL; it does not claim to execute a named item from My Queries.

## Source and credentials

- MCP server: `philips-azure-devops`
- Query tool: `query_work_items`
- PAT and proxy bypass are read by the existing launcher from the current Windows user's environment.
- Never place a PAT in this task file, an MCP config, a report, or source control.

## Read-only boundary

Allowed tools: `test_connection` and `query_work_items` for the filters above.

Do not create, update, transition, delete, or comment on ADS records. Keep MCP write access disabled.

## Excel output

Write `evals/reports/daily-bugs/YYYY-MM-DD.xlsx` locally. The report contains:

- `RawData`: the five requested source fields.
- `Resolution`: Created Date, ID, Title, State, Tags, and derived Resolution.
- `每日Issue统计`: daily created issue totals and daily Resolution-category counts.
- `Daily`: overall and per-day Resolution summaries, a Created Issues line chart with a data table and value labels, and a stacked daily Resolution distribution chart with a data table and rotated date labels. Chart colors and axis formatting are fixed to match the report template.

Resolution rules:

- `Resolved`, `Verified`, or `Closed` with a `Legacy` tag becomes `ToFix:Legacy`.
- Those terminal states with a `new requirement` tag become `ToFix:New Requirement`; otherwise `ToFix:Defect`.
- `Accepted` with `Legacy` becomes `Accepted:Legacy`.
- `Accepted` with `new requirement` becomes `Accepted:New Requirement`; otherwise `Accepted:Defect`.
- All other states are preserved as-is.

Tag matching is case-insensitive. If both tag phrases exist, `Legacy` takes precedence. Reports contain work-item data, are local-only, and are excluded from Git.

## Run and schedule

Manual run from the workspace root:

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\ai-agent-harness\src\run-bug-status.mjs'
```

Windows Task Scheduler invokes the same runner as the current user. See the Harness README for schedule registration and removal commands. The user must be signed in for the interactive-token task to access the user's PAT.