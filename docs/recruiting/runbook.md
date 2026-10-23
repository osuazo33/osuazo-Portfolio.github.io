# Runbook

Commands run from the repository root. They read `DATABASE_URL` from `.env`
(copy `.env.example`; `.env` is git-ignored) or from the environment. Never paste the
connection string into code, docs, commit messages or logs.

## Setup (once)

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows; .venv/bin/python on macOS/Linux
python scripts/run_sql.py sql/recruiting/04_simulation_tables.sql --commit   # safe to repeat
```

`04_simulation_tables.sql` only creates what is missing. Do **not** re-run
`01_create_tables.sql`: it starts with `DROP SCHEMA` and deletes everything,
including the n8n log.

## Seed

```bash
python scripts/seed_data.py --dry-run   # generate and print the summary, write nothing
python scripts/seed_data.py             # load into empty tables
python scripts/seed_data.py --reset     # TRUNCATE the data tables and reload
```

`--reset` truncates `application_events`, `applications`, `candidates`,
`requisition_queue`, `jobs`, `recruiters` and `simulation_runs`. It never touches
`automation_runs`. Without `--reset` the script refuses to run on non-empty tables.
The load is a single transaction: if any row is rejected nothing is written. If that
happens, fix the generator, not the constraints.

## Daily simulator

```bash
python scripts/simulate_day.py --dry-run    # show what would change, then roll back
python scripts/simulate_day.py              # catch up every missing day up to yesterday
python scripts/simulate_day.py --verbose    # list every change
```

- Simulates each day after the latest `success`/`seed` row in `simulation_runs`, up to
  yesterday (Guatemala time), at most 30 per run. Running it twice is harmless:
  the second run prints `Up to date`.
- Each day is its own transaction. On failure the day is rolled back, an `error` row
  with the message is written for that date, the script exits with code 1, and the
  next run retries that day (the row is overwritten with `success`).

### Schedule: GitHub Actions (main option)

`.github/workflows/simulate_day.yml` runs at 13:00 UTC (07:00 Guatemala), one hour
before n8n, and can be started by hand (Actions → *Simulate recruiting day* →
*Run workflow*, with an optional dry run). It needs one repository secret:

1. On GitHub open the repository → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**. Name: `DATABASE_URL`. Value: the same connection string
   as in your `.env` (Supabase → Project Settings → Database → Connection string,
   session pooler, with your password filled in and no brackets).
3. **Add secret**. Then Actions → *Simulate recruiting day* → **Run workflow** with
   *dry run* checked; the log should list the pending days or say `Up to date`.

GitHub disables scheduled workflows after 60 days without commits in the repository.
If that happens, re-enable it in the Actions tab; the next run catches up (30 days
per run, run it again for more).

### Schedule: Windows Task Scheduler (fallback)

Use only if not using GitHub Actions (both together are safe, since the simulator is
idempotent and takes a database lock, but there is no reason to run both).

1. Task Scheduler → **Create Basic Task** → name `Recruiting simulator` → **Daily**, 07:00.
2. Action **Start a program**: `C:\Users\<you>\...\osuazo-Portfolio.github.io\scripts\simulate_day.bat`.
3. In the task properties enable **Run task as soon as possible after a scheduled
   start is missed**. Output is appended to `logs\simulate_day.log` (git-ignored).

## Validation and KPIs

```bash
python scripts/run_sql.py sql/recruiting/05_validation.sql
python scripts/run_sql.py sql/recruiting/06_kpis.sql
```

Both are read-only (the runner rolls back unless `--commit` is passed). In
`05_validation.sql` every row of query 5b must be 0. If one is not, look at the
check name, query the offending rows, and fix the generator or simulator. The check
`missing day in simulation_runs` is non-zero while a day is in `error` and clears
when it is retried successfully.

## n8n alert (`vacancy_aging_alert`)

Runs daily at 08:00 America/Guatemala in the local n8n: reads jobs with
`status = 'open'`, flags `days_open ≥ 45` or `days_since_update ≥ 14`, emails an HTML
table of the flagged jobs (SMTP) and writes one row to `recruiting.automation_runs`.

**Test it:**

1. Make sure the simulator ran today (`simulation_runs` has yesterday as `success`)
   and that `06_kpis.sql` query 6c or 6b shows open jobs over the thresholds.
2. In n8n open the workflow and click **Execute workflow**.
3. Check the email arrives with the flagged jobs, then check the log:

   ```sql
   SELECT run_at, jobs_checked, jobs_flagged, flagged_job_ids, alert_sent, status, error_message
   FROM recruiting.automation_runs ORDER BY run_at DESC LIMIT 5;
   ```

   `jobs_checked` should equal the open vacancies in 6a and `flagged_job_ids` should
   contain the jobs from 6b (46+ days) and 6c.

**If it fails:**

| Symptom | Check |
|---|---|
| No `automation_runs` row today | PC off or n8n not running at 08:00. Start n8n and run the workflow by hand. |
| Row with `status = 'error'` | Read `error_message`; open the failed execution in n8n → *Executions*. |
| Database node fails to connect | Supabase project paused (free tier pauses after inactivity: resume it in the dashboard) or the password changed: update the n8n Postgres credential. |
| `jobs_flagged > 0` but no email | SMTP credential (Gmail app password) expired or revoked; re-create it in n8n. Check spam. |
| `jobs_checked = 0` | The data was reset or the simulator is not running; check `simulation_runs`. |

## Exporting the n8n workflow

n8n → open the workflow → menu (⋯) → **Download**. Save it as
`workflows/vacancy_aging_alert.json`. Before committing, confirm it contains only
credential names/IDs, never passwords, tokens or connection strings.
