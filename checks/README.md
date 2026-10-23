# Data-quality checks

`run_checks.py` runs four checks on the GA4 obfuscated ecommerce sample and appends one row per
check to `logs/quality_log.csv`: `test_name, run_timestamp, window_start, window_end, status,
affected_rows, severity, resolution, detail, bytes_processed`.

| Check | Severity | Fails when |
|---|---|---|
| `missing_user_identifiers` | High | any event row in the window has `user_pseudo_id IS NULL` |
| `duplicated_transaction_ids` | High | a transaction ID appears on more than one `purchase` event |
| `unexpected_event_volume` | Medium | a day's row count is outside mean ± 3 SD of 20201101–20201128 (weekday and weekend separately) |
| `stale_data` | Medium | the latest daily table (the expected date) is empty, or a day between the first and last table is missing |

```bash
pip install -r checks/requirements.txt
gcloud auth application-default login
python checks/run_checks.py --project YOUR_BILLING_PROJECT                    # 20201101-20201107
python checks/run_checks.py --project YOUR_BILLING_PROJECT --start 20201201 --end 20201207
# optional: also append to a BigQuery table in your project
python checks/run_checks.py --project YOUR_BILLING_PROJECT --bq-table YOUR_BILLING_PROJECT.marketing_quality.check_log
```

Every query is dry-run first. If a dry run is above `--max-gb` (default 1), the query is not run
and the check is logged as `ERROR`. The committed log holds the W1 and W5 runs used in `findings.md`.
