-- Step 2. Starter profile: event rows and missing user_pseudo_id per day and event,
-- for one week. Based on sql/marketing_quality_template.sql, with the date range
-- moved to the first week of the sample (20201101-20201107) to keep the scan small.
-- Reads only event_date, event_name and user_pseudo_id.

SELECT
  event_date,
  event_name,
  COUNT(*) AS event_rows,
  COUNTIF(user_pseudo_id IS NULL) AS rows_missing_user_id
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20201107'
GROUP BY event_date, event_name
ORDER BY event_date, event_rows DESC;
-- @@
-- 2b. Week totals per event, to read the profile without scrolling 7 days.
SELECT
  event_name,
  COUNT(*) AS event_rows,
  COUNTIF(user_pseudo_id IS NULL) AS rows_missing_user_id,
  COUNT(DISTINCT event_date) AS days_present
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20201107'
GROUP BY event_name
ORDER BY event_rows DESC;
