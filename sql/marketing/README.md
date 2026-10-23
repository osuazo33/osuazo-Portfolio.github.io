# Marketing Data Quality: SQL

GA4 obfuscated ecommerce sample, `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`.
Results and definition decisions are in [`findings.md`](../../findings.md).

Cost rules followed by every file: filter with `_TABLE_SUFFIX`, start with 20201101–20201107,
select only the needed columns (never `SELECT *` on `events_*`), dry-run before running.
Files with several queries separate them with a `-- @@` line; run each one on its own.

| File | Step | Reads | Dry run |
|---|---|---|---|
| `01_inspect_schema.sql` | 1. Date coverage, field types, `event_params` keys per event | metadata; 1 week of `event_params` | 0.01–0.11 GB |
| `02_profile_week.sql` | 2. Rows and missing `user_pseudo_id` per day and event (starter template) | 1 week | 0.014 GB |
| `03a_funnel_event_coverage.sql` | 3. Daily funnel event counts for all 92 days (found the `add_to_cart` gap) | `event_name` only | 0.10 GB |
| `03b_funnel.sql` | 3. Ordered funnel at user and session level, W1 and W5 | 2 weeks | 0.19 GB |
| `04_traffic_sources.sql` | 4. Users and sessions by source/medium/campaign; obfuscation share | 1 week | 0.02–0.12 GB |
| `05_purchase_validation.sql` | 5. Purchase counts, transaction IDs, revenue reconciliation; published figures come from 5d | 2 weeks, purchases | 0.17–0.27 GB |

Step 6 (quality checks) is in [`checks/run_checks.py`](../../checks/run_checks.py).
Step 7: ROAS and CPA are not calculated, because the dataset has no campaign spend.
