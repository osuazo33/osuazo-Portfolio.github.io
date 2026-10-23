-- Step 3b. Product funnel view_item -> add_to_cart -> purchase, at user and session level.
--
-- Definitions
--   Session      user_pseudo_id + event_params.ga_session_id (int_value). ga_session_id
--                alone is a timestamp and is not unique across users.
--   Reached step a user/session has at least one event of that name in the week.
--   Ordered      each step must happen at or after the first timestamp of the previous
--                step: first view_item <= an add_to_cart, and that add_to_cart <= a purchase.
--                Session level is ordered inside the session only.
--   Conversion   step / view_item (from the top) and step / previous step.
--
-- Two weeks are reported side by side:
--   W1 20201101-20201107  the required first week; add_to_cart is tracked only on
--                         20201101 (see 03a), so its middle step is not usable.
--   W5 20201201-20201207  a week with complete add_to_cart tracking.
-- Columns read: event_name, event_timestamp, user_pseudo_id, event_params.

WITH ev AS (
  SELECT
    IF(_TABLE_SUFFIX <= '20201107', 'W1 Nov 1-7', 'W5 Dec 1-7') AS week,
    user_pseudo_id,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
    event_name,
    event_timestamp
  FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
  WHERE (_TABLE_SUFFIX BETWEEN '20201101' AND '20201107' OR _TABLE_SUFFIX BETWEEN '20201201' AND '20201207')
    AND event_name IN ('view_item', 'add_to_cart', 'purchase')
),
-- First view and the add_to_cart / purchase timestamps needed for ordering, per unit.
per_unit AS (
  SELECT
    week, level, unit_id,
    MIN(IF(event_name = 'view_item', event_timestamp, NULL)) AS first_view,
    ARRAY_AGG(IF(event_name = 'add_to_cart', event_timestamp, NULL) IGNORE NULLS) AS carts,
    ARRAY_AGG(IF(event_name = 'purchase', event_timestamp, NULL) IGNORE NULLS) AS purchases
  FROM ev, UNNEST([
    STRUCT('user' AS level, user_pseudo_id AS unit_id),
    STRUCT('session', CONCAT(user_pseudo_id, '-', CAST(ga_session_id AS STRING)))
  ])
  WHERE unit_id IS NOT NULL
  GROUP BY week, level, unit_id
),
flags AS (
  SELECT
    week, level,
    first_view IS NOT NULL AS viewed,
    -- ARRAY_AGG(... IGNORE NULLS) returns NULL, not [], when there is nothing to collect
    IFNULL(ARRAY_LENGTH(carts), 0) > 0 AS carted,
    IFNULL(ARRAY_LENGTH(purchases), 0) > 0 AS purchased,
    -- first add_to_cart at or after the first view
    (SELECT MIN(c) FROM UNNEST(carts) AS c WHERE c >= first_view) AS cart_after_view,
    purchases
  FROM per_unit
)
SELECT
  week, level,
  COUNTIF(viewed) AS view_item,
  COUNTIF(carted) AS add_to_cart_any,
  COUNTIF(purchased) AS purchase_any,
  COUNTIF(cart_after_view IS NOT NULL) AS add_to_cart_ordered,
  COUNTIF(cart_after_view IS NOT NULL
          AND EXISTS (SELECT 1 FROM UNNEST(purchases) AS p WHERE p >= cart_after_view)) AS purchase_ordered,
  ROUND(SAFE_DIVIDE(COUNTIF(cart_after_view IS NOT NULL), COUNTIF(viewed)) * 100, 2) AS pct_view_to_cart,
  ROUND(SAFE_DIVIDE(
    COUNTIF(cart_after_view IS NOT NULL AND EXISTS (SELECT 1 FROM UNNEST(purchases) AS p WHERE p >= cart_after_view)),
    COUNTIF(cart_after_view IS NOT NULL)) * 100, 2) AS pct_cart_to_purchase,
  ROUND(SAFE_DIVIDE(
    COUNTIF(cart_after_view IS NOT NULL AND EXISTS (SELECT 1 FROM UNNEST(purchases) AS p WHERE p >= cart_after_view)),
    COUNTIF(viewed)) * 100, 2) AS pct_view_to_purchase,
  -- purchases with no add_to_cart in the same unit: a direct sign of missing cart tracking
  COUNTIF(purchased AND NOT carted) AS purchase_without_cart
FROM flags
GROUP BY week, level
ORDER BY week, level DESC;
-- @@
-- 3c. Session key sanity: events in the funnel without a ga_session_id would be
--     dropped from the session level silently, so count them explicitly.
SELECT
  IF(_TABLE_SUFFIX <= '20201107', 'W1 Nov 1-7', 'W5 Dec 1-7') AS week,
  COUNT(*) AS funnel_events,
  COUNTIF((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') IS NULL) AS missing_ga_session_id
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
WHERE (_TABLE_SUFFIX BETWEEN '20201101' AND '20201107' OR _TABLE_SUFFIX BETWEEN '20201201' AND '20201207')
  AND event_name IN ('view_item', 'add_to_cart', 'purchase')
GROUP BY week
ORDER BY week;
