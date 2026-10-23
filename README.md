Osman — Data Analytics & Automation Portfolio

End-to-end analytics projects built the way I work day to day: SQL first, validated numbers, automated pipelines, and dashboards people can actually use.

I worked on a Reporting team at Alorica , where I build Python automation, data-processing pipelines, SQL Server loads and Excel/OneDrive reporting workflows. I'm also studying a B.S. in Data Science and Artificial Intelligence at Unitec. This repository is the public, non-confidential side of that work: every project here uses public or synthetic data.

🌐 Live site: published with GitHub Pages from this repository (index.html at the root). 🗣️ Spanish (native) · English (fluent)

Projects
#	Project	What it shows	Stack	Status
1	Sales Intelligence & Automated Revenue Pipeline	Revenue KPIs, delivery performance and data-quality checks on real e-commerce orders	BigQuery SQL · Looker Studio · n8n	Dashboard live, automation in progress
2	Recruiting & Vacancy Performance	Vacancy aging, pipeline KPIs and daily stale-vacancy alerts on a database that changes every day	PostgreSQL (Supabase) · Python · GitHub Actions · n8n	Running daily
3	Marketing Funnel & Data Quality	Product funnel and data-quality checks on GA4 event data	BigQuery SQL (GA4 public sample)	In progress
★	Operations Monitor (live demo)	Real-time order dashboard: KPIs, animated charts, sortable table, notifications	Vanilla JS · SVG charts · DummyJSON API	Live
1. Sales Intelligence & Automated Revenue Pipeline
Data: Brazilian E-Commerce Public Dataset by Olist (~100k orders, 2016–2018) loaded into BigQuery.
SQL: profiling (sql/01_profile_source_data.sql), sales KPIs (sql/02_sales_kpis.sql) and data-quality checks (sql/03_data_quality_checks.sql), with a documented revenue definition and joins checked so order totals are not inflated.
Dashboard: Sales Intelligence in Looker Studio, embedded live in the project page instead of just linked.
Automation (next): n8n workflow for scheduled loads, run logging, failure alerts and idempotent reloads.
2. Recruiting & Vacancy Performance
Data: synthetic jobs, candidates, applications and recruiters in a Supabase PostgreSQL database. No real people.
Pipeline: a Python seed script builds the initial data; a daily simulator on GitHub Actions (.github/) advances applications and vacancies so the KPIs move like a real operation.
SQL: validations and KPIs in sql/recruiting/ (PostgreSQL), including vacancy aging and stale-vacancy detection.
Alerts: an n8n workflow (exported in workflows/, no credentials) emails a daily summary of aging and stale vacancies.
Docs: overview and architecture in docs/recruiting/README.md; how to run it in docs/recruiting/runbook.md.
3. Marketing Funnel & Data Quality
Data: the public GA4 e-commerce sample (bigquery-public-data.ga4_obfuscated_sample_ecommerce).
Focus: a product funnel (view → add to cart → checkout → purchase) plus data-quality checks on the event data before trusting any conversion rate.
Page: projects/marketing-quality.html.
★ Operations Monitor (live demo)

dashboards/operations-monitor.html is a real-time order dashboard with KPI cards, animated SVG charts, a sortable/paginated orders table, demo notifications, light/dark theme, a collapsible sidebar and reorderable KPI cards.

Data honesty: orders are simulated in the browser. The product catalog is fetched once from the public DummyJSON API (7 s timeout, local fallback), and the status line always says which mode is active.
Updates: polling every 3–5 s (configurable), paused while the tab is hidden.
Consistency: each order decides its outcome when it is created, so KPIs, charts, table and notifications all come from the same rows.
Preferences in localStorage: theme (pf-theme), KPI order, sidebar state, refresh interval, rows per page.
Skills demonstrated
SQL: BigQuery and PostgreSQL — profiling, KPI views, window functions, data-quality checks, join-inflation checks.
Python: data generation, daily simulation, SQL runners, environment-based configuration.
Automation: n8n workflows (scheduled runs, alerts, logging) and GitHub Actions.
BI: Looker Studio dashboards and a hand-built JavaScript dashboard with no dependencies.
Data quality: documented metric definitions, validated numbers before visualizing them, visible exceptions.
Repository structure
index.html  styles.css  script.js  404.html
assets/js/    ops-data.js (order simulation + metrics), charts.js (SVG charts, no dependencies)
dashboards/   operations-monitor.html + dashboard.css + dashboard.js
projects/     case-study pages (sales, recruiting, marketing)
sql/          BigQuery queries; sql/recruiting/ is PostgreSQL (Supabase)
scripts/      recruiting seed, daily simulator and SQL runner (Python)
docs/         data model, architecture and QA plan; docs/recruiting/ for project 2
workflows/    exported n8n workflows (no credentials)
.github/      GitHub Actions: daily recruiting simulator
data/         data notes (raw files are git-ignored)
Run it locally

The website has no build step and no npm dependencies: open index.html directly or serve the folder with any static server, for example:

bash
python -m http.server 8000

The recruiting scripts need Python, pip install -r requirements.txt and a DATABASE_URL in .env (see .env.example). Full steps are in the runbook.

Publishing (GitHub Pages)

Settings → Pages → Deploy from a branch → main / (root). The hidden .nojekyll file must stay at the root. After each change, test the links in a private window on desktop and mobile.

Roadmap
 n8n pipeline for the Olist project (scheduled load, logging, failure alerts, idempotent reloads)
 Dashboard screenshots on the Olist project page
 Written findings and limitations for each case study
 Finish the GA4 funnel and data-quality results
 Replace illustrative KPI graphics on the home page with verified values (or keep them labeled as illustrative)
Data & security
All data is public (Olist, GA4 sample, DummyJSON) or synthetic (recruiting). No employer or customer data is used.
No API keys, service-account JSON, passwords, OAuth tokens or n8n credentials are committed; secrets live in .env and GitHub Actions secrets.
KPI graphics on the home page are illustrative UI unless a page says the values come from a validated query.
