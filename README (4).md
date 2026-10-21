# n8n workflows

Put exported n8n workflow JSON files here (n8n → workflow menu → Download).

Before committing each file:
- Confirm it contains no credentials, API keys, tokens, or personal webhook URLs.
- Name files by purpose, e.g. `olist_daily_load.json`, `data_quality_alerts.json`, `stale_vacancies_alert.json`.
- Document in this README what each workflow does, its trigger/schedule, and how it avoids duplicate loads on retry (e.g. `MERGE` on a business key or truncate-and-load of a partition).

Mark a workflow as "implemented" on the project page only after it has run successfully.
