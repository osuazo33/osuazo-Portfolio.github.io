# Architecture and data quality plan

## Initial architecture

CSV / public source → BigQuery source tables → SQL reporting model → Looker Studio dashboard.

## Target automation

n8n scheduled trigger → ingest or refresh data → execute validation queries → record run status and row counts → notify on failure → dashboard consumes validated reporting data.

## Quality checks

1. **Uniqueness:** primary business keys are unique at the documented table grain.
2. **Completeness:** required IDs and dates are not unexpectedly null.
3. **Referential integrity:** child records reference valid parent records.
4. **Validity:** dates and numeric values meet documented rules.
5. **Reconciliation:** item-level sums and payment sums are compared separately; differences are explained rather than automatically treated as errors.
6. **Freshness:** latest successful load time meets the agreed schedule.
7. **Volume:** row counts are compared with a baseline, with thresholds documented.
8. **Failure handling:** retries are bounded; failures are logged and surfaced.

## Execution log fields

`run_id`, `started_at`, `finished_at`, `status`, `source_name`, `rows_read`, `rows_written`, `failed_checks`, `error_message`, `workflow_version`.

## Security

Use public or synthetic data. Never commit credentials. Export n8n workflows without secrets. Use least-privilege permissions and test public dashboard access separately.
