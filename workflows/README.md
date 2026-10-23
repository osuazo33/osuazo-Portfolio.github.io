# n8n workflows

Put exported n8n workflow JSON files here (n8n → workflow menu → Download).

Before committing each file:
- Confirm it contains no credentials, API keys, tokens, or personal webhook URLs.
- Name files by purpose, e.g. `olist_daily_load.json`, `data_quality_alerts.json`, `stale_vacancies_alert.json`.
- Document in this README what each workflow does, its trigger/schedule, and how it avoids duplicate loads on retry (e.g. `MERGE` on a business key or truncate-and-load of a partition).

Mark a workflow as "implemented" on the project page only after it has run successfully.

## Workflows

| File | What it does | Trigger | Duplicates on retry |
|---|---|---|---|
| `vacancy_aging_alert.json` | Reads open jobs in `recruiting.jobs`, flags `days_open >= 45` or `days_since_update >= 14`, emails an HTML table of flagged jobs and writes one row to `recruiting.automation_runs` | Schedule, daily 08:00 America/Guatemala (local n8n) | Read-only on the data; a retry only adds another log row and email |

Export pending: save the n8n download here as `vacancy_aging_alert.json`. Details and
troubleshooting: [`docs/recruiting/runbook.md`](../docs/recruiting/runbook.md).
