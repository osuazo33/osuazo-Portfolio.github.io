-- Step 4. Users and sessions by source / medium / campaign, first week (20201101-20201107).
--
-- Two candidate fields:
--   traffic_source.{source, medium, name}  GA4 export: the source that FIRST acquired the
--       user (user scope). It does not change per session, so it answers "where did our
--       users come from", not "which campaign drove this session".
--   event_params keys source / medium / campaign  session-scope values, but GA4 only
--       writes them on some events. 4c measures how many sessions carry them at all.
-- collected_traffic_source does not exist in this export (see step 1).
-- Obfuscated values in this sample: '<Other>' and '(data deleted)'.
-- Columns read: user_pseudo_id, traffic_source, event_name, event_params.

-- 4a. Users and sessions by traffic_source (first-touch), top 25.
WITH ev AS (
  SELECT
    user_pseudo_id,
    CONCAT(user_pseudo_id, '-', CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)) AS session_id,
    traffic_source.source, traffic_source.medium, traffic_source.name AS campaign
  FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20201107'
)
SELECT
  source, medium, campaign,
  COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(DISTINCT session_id) AS sessions
FROM ev
GROUP BY source, medium, campaign
ORDER BY users DESC
LIMIT 25;
-- @@
-- 4b. Obfuscation share of traffic_source, measured on users. traffic_source should be
--     one value per user, but users_with_more_than_one_value shows it is not always
--     (obfuscation is applied per row), so each user takes the value on their first event.
WITH u AS (
  SELECT
    user_pseudo_id,
    COUNT(DISTINCT FORMAT('%T', traffic_source)) AS distinct_values,
    ARRAY_AGG(traffic_source ORDER BY event_timestamp LIMIT 1)[OFFSET(0)] AS ts
  FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20201107'
  GROUP BY user_pseudo_id
)
SELECT
  COUNT(*) AS users,
  COUNTIF(distinct_values > 1) AS users_with_more_than_one_value,
  ROUND(COUNTIF(ts.source IN ('<Other>', '(data deleted)')) / COUNT(*) * 100, 2) AS pct_source_obfuscated,
  ROUND(COUNTIF(ts.medium IN ('<Other>', '(data deleted)')) / COUNT(*) * 100, 2) AS pct_medium_obfuscated,
  ROUND(COUNTIF(ts.name IN ('<Other>', '(data deleted)')) / COUNT(*) * 100, 2) AS pct_campaign_obfuscated,
  ROUND(COUNTIF(ts.source IN ('<Other>', '(data deleted)')
             OR ts.medium IN ('<Other>', '(data deleted)')
             OR ts.name IN ('<Other>', '(data deleted)')) / COUNT(*) * 100, 2) AS pct_any_field_obfuscated
FROM u;
-- @@
-- 4c. Coverage and obfuscation of the session-scope keys in event_params.
--     A session "has" a source if any of its events carries the key.
WITH s0 AS (
  SELECT
    CONCAT(user_pseudo_id, '-', CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)) AS session_id,
    -- first event in the session that carries a source; the three values come from that same event
    ARRAY_AGG(
      IF((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'source') IS NULL, NULL, STRUCT(
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'source') AS source,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'medium') AS medium,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'campaign') AS campaign))
      IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS first_src
  FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20201107'
  GROUP BY session_id
),
s AS (SELECT session_id, first_src.source, first_src.medium, first_src.campaign FROM s0)
SELECT
  COUNT(*) AS sessions,
  COUNTIF(source IS NOT NULL) AS sessions_with_source_param,
  ROUND(COUNTIF(source IS NOT NULL) / COUNT(*) * 100, 2) AS pct_sessions_with_source_param,
  ROUND(SAFE_DIVIDE(COUNTIF(source IN ('<Other>', '(data deleted)')), COUNTIF(source IS NOT NULL)) * 100, 2) AS pct_source_param_obfuscated,
  ROUND(SAFE_DIVIDE(COUNTIF(campaign IN ('<Other>', '(data deleted)')), COUNTIF(campaign IS NOT NULL)) * 100, 2) AS pct_campaign_param_obfuscated
FROM s;
-- @@
-- 4d. Which events carry the source param (explains the low coverage in 4c).
SELECT event_name, COUNT(*) AS events_with_source_param
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20201107'
  AND EXISTS (SELECT 1 FROM UNNEST(event_params) WHERE key = 'source')
GROUP BY event_name
ORDER BY events_with_source_param DESC;
-- @@
-- 4e. Users and sessions by the session-scope keys (event_params), top 25. Sessions with
--     no source param on any event are grouped as '(no param)' so the totals stay visible.
WITH s0 AS (
  SELECT
    user_pseudo_id,
    CONCAT(user_pseudo_id, '-', CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)) AS session_id,
    -- first event in the session that carries a source; the three values come from that same event
    ARRAY_AGG(
      IF((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'source') IS NULL, NULL, STRUCT(
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'source') AS source,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'medium') AS medium,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'campaign') AS campaign))
      IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS first_src
  FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20201107'
  GROUP BY user_pseudo_id, session_id
),
s AS (SELECT user_pseudo_id, session_id, first_src.source, first_src.medium, first_src.campaign FROM s0)
SELECT
  IFNULL(source, '(no param)') AS source,
  IFNULL(medium, '(no param)') AS medium,
  IFNULL(campaign, '(no param)') AS campaign,
  COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(*) AS sessions
FROM s
GROUP BY source, medium, campaign
ORDER BY sessions DESC
LIMIT 25;
