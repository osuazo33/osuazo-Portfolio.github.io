# BigQuery SQL starter files

Before running these scripts:
1. Import the Olist CSV files into a BigQuery dataset.
2. Replace every `YOUR_PROJECT.YOUR_DATASET` with your actual project and dataset IDs.
3. Confirm column names and types in the imported schema.
4. Run the profiling query first and review its output.

These are starter templates, not pre-validated results. Depending on how you import CSVs, date columns may be STRING or TIMESTAMP/DATETIME. The scripts use `SAFE_CAST` where appropriate and should be reviewed against your schema.

## Files

| File | Purpose |
|---|---|
| `01_profile_source_data.sql` | Row counts, nulls, distinct keys, order status distribution |
| `02_sales_kpis.sql` | Monthly orders, item revenue, payments, on-time delivery |
| `03_data_quality_checks.sql` | Duplicates, orphans, invalid values, missing dates |
| `marketing_quality_template.sql` | GA4 sample starter (Project 3) |
