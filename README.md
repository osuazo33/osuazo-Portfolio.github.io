# Data Analytics & Automation Portfolio

A responsive static portfolio for GitHub Pages, with project pages, BigQuery SQL templates, and documentation for a portfolio focused on SQL, BigQuery, ETL, n8n, data quality, and business intelligence.

## Before publishing

Search the project for these placeholders and replace them:
- The About section (use your real experience and tools)
- Dashboard links and screenshots once the reports are built
- Any claim about results or tools you have not verified

**Important:** the KPI graphics on the home page are illustrative UI, not real dataset results. Keep them labeled as illustrative or replace them with verified values.

## Publish on GitHub Pages

1. Create a public repository, e.g. `data-analytics-portfolio`.
2. Upload the **contents** of this folder to the repository root (`index.html` must be at the root, including the hidden `.nojekyll` file).
3. **Settings → Pages → Deploy from a branch**, select `main` and `/ (root)`, save.
4. Open the published URL and test every link in a private window, on desktop and mobile.

## Structure

```
index.html  styles.css  script.js  404.html
assets/js/    ops-data.js (order simulation + metrics), charts.js (SVG charts, no dependencies)
dashboards/   operations-monitor.html + dashboard.css + dashboard.js (live demo)
projects/     case-study pages (sales, recruiting, marketing)
sql/          BigQuery starter queries; sql/recruiting/ is PostgreSQL (Supabase)
scripts/      recruiting seed, daily simulator and SQL runner (Python)
docs/         data model, architecture and QA plan; docs/recruiting/ for project 2
workflows/    exported n8n workflows (no credentials)
.github/      GitHub Actions: daily recruiting simulator
data/         data notes (raw files are git-ignored)
```

No build step and no npm dependencies for the site: open `index.html` directly or serve the folder with any static server.

## Operations Monitor (live demo)

`dashboards/operations-monitor.html` is a real-time order dashboard with KPIs, animated charts, a sortable/paginated orders table, demo notifications, light/dark theme, a collapsible sidebar and reorderable KPI cards.

- **Data honesty:** orders are **simulated in the browser**; the product catalog is fetched once from the public [DummyJSON API](https://dummyjson.com) with a 7 s timeout and a local fallback. The status line always says which mode is active.
- **Updates:** polling every 3–5 s (configurable), paused automatically while the tab is hidden. No streaming API is used.
- **Consistency:** every order decides its outcome when it is created, so KPIs, charts, table and notifications are computed from the same rows.
- **Preferences** stored in `localStorage`: theme (`pf-theme`), KPI order, sidebar state, interval, rows per page.

## Flagship project: Olist Sales Intelligence

Dataset: [Brazilian E-Commerce Public Dataset by Olist](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce).

Dashboard: [Sales Intelligence in Looker Studio](https://lookerstudio.google.com/reporting/ec3e756b-2a8a-48c7-b87c-4bfd03b2d180)

Recommended build order:
1. Load CSVs into BigQuery.
2. Run `sql/01_profile_source_data.sql`.
3. Run `sql/02_sales_kpis.sql` and validate the results.
4. Run `sql/03_data_quality_checks.sql`.
5. Connect Looker Studio to a verified reporting view.
6. Build the n8n workflow (scheduled load, run logging, failure alerts, idempotent reloads).
7. ~~Add the public dashboard URL to the project page.~~ Done; screenshots still to add.
8. Write the real findings and limitations in the case study.

## Recruiting & Vacancy Performance

Synthetic recruiting data in Supabase Postgres, advanced every day by a Python simulator
on GitHub Actions, with SQL validations and KPIs and a local n8n email alert for aging
and stale vacancies. Overview and architecture: [`docs/recruiting/README.md`](docs/recruiting/README.md);
how to run it: [`docs/recruiting/runbook.md`](docs/recruiting/runbook.md).
The Python scripts need `requirements.txt` and a `DATABASE_URL` in `.env` (see `.env.example`).

## Dashboard checklist

- [ ] KPI cards use validated SQL results
- [ ] Revenue definition is documented
- [ ] Date filters work
- [ ] No order totals inflated by joins
- [ ] Delivery metric explains its denominator
- [ ] Data-quality exceptions are visible
- [ ] Public sharing tested in a private window
- [ ] No sensitive information

## Security

Never commit API keys, service-account JSON, passwords, OAuth tokens, real customer data, or n8n credentials. Use public or synthetic data.
