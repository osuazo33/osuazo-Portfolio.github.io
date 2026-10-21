# Data Analytics & Automation Portfolio

A responsive static portfolio for GitHub Pages, with project pages, BigQuery SQL templates, and documentation for a portfolio focused on SQL, BigQuery, ETL, n8n, data quality, and business intelligence.

## Before publishing

Search the project for these placeholders and replace them:
- `YOUR-GITHUB-USERNAME`
- `YOUR_EMAIL@example.com`
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
projects/     case-study pages (sales, recruiting, marketing)
sql/          BigQuery starter queries
docs/         data model, architecture and QA plan
dashboards/   screenshots and dashboard links
workflows/    exported n8n workflows (no credentials)
data/         data notes (raw files are git-ignored)
assets/       images and diagrams
```

## Flagship project: Olist Sales Intelligence

Dataset: [Brazilian E-Commerce Public Dataset by Olist](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce).

Recommended build order:
1. Load CSVs into BigQuery.
2. Run `sql/01_profile_source_data.sql`.
3. Run `sql/02_sales_kpis.sql` and validate the results.
4. Run `sql/03_data_quality_checks.sql`.
5. Connect Looker Studio to a verified reporting view.
6. Build the n8n workflow (scheduled load, run logging, failure alerts, idempotent reloads).
7. Add screenshots and the public dashboard URL to the project page.
8. Write the real findings and limitations in the case study.

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
