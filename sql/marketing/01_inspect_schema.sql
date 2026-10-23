-- Step 1. Inspect the schema of the GA4 obfuscated ecommerce sample.
-- Metadata queries only: INFORMATION_SCHEMA reads no event rows, so the cost is
-- the 10 MB minimum. Run each statement separately (separated by "-- @@").

-- 1a. Date coverage: first and last daily table. The last suffix is the
--     "expected date" used by the stale-data check (step 6), not today's date.
SELECT
  COUNT(*) AS daily_tables,
  MIN(REGEXP_EXTRACT(table_name, r'^events_(\d{8})$')) AS first_suffix,
  MAX(REGEXP_EXTRACT(table_name, r'^events_(\d{8})$')) AS last_suffix
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(table_name, r'^events_\d{8}$');
-- @@
-- 1b. Fields used by this project, with their types, taken from one daily table.
--     collected_traffic_source and session_traffic_source_last_click only exist
--     in newer GA4 exports; if they are missing they simply do not appear here.
SELECT field_path, data_type
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
WHERE table_name = 'events_20201101'
  AND (
    field_path IN ('event_date', 'event_timestamp', 'event_name', 'user_pseudo_id', 'user_id')
    OR STARTS_WITH(field_path, 'event_params')
    OR STARTS_WITH(field_path, 'ecommerce')
    OR STARTS_WITH(field_path, 'traffic_source')
    OR STARTS_WITH(field_path, 'collected_traffic_source')
    OR STARTS_WITH(field_path, 'session_traffic_source')
  )
ORDER BY field_path;
-- @@
-- 1c. Every top-level column, to confirm nothing relevant is missed.
SELECT column_name, data_type
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'events_20201101'
ORDER BY ordinal_position;
-- @@
-- 1d. Which event_params keys exist, on which value field, for the events in the
--     funnel and attribution. One week, only event_name + event_params are read.
SELECT
  event_name,
  ep.key,
  COUNT(*) AS rows_with_key,
  COUNTIF(ep.value.string_value IS NOT NULL) AS as_string,
  COUNTIF(ep.value.int_value IS NOT NULL) AS as_int,
  COUNTIF(ep.value.double_value IS NOT NULL OR ep.value.float_value IS NOT NULL) AS as_double
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`, UNNEST(event_params) AS ep
WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20201107'
  AND event_name IN ('session_start', 'view_item', 'add_to_cart', 'purchase')
GROUP BY event_name, ep.key
ORDER BY event_name, rows_with_key DESC;
