-- Template for GA4 ecommerce sample tables in BigQuery.
-- Use only after confirming access to bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*.
-- This sample is separate from the Olist flagship project.
-- Scan a limited date range to control query cost.

SELECT
  event_date,
  event_name,
  COUNT(*) AS event_rows,
  COUNTIF(user_pseudo_id IS NULL) AS rows_missing_user_id
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210107'
GROUP BY event_date, event_name
ORDER BY event_date, event_rows DESC;

-- Add conversion funnel and campaign attribution only after checking the schema
-- and documenting the definition of a session, purchase, and attribution window.
