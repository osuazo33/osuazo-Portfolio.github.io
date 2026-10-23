-- Step 5. Validate purchase counts and purchase value, W1 (20201101-20201107) and
-- W5 (20201201-20201207, the week with complete funnel tracking).
--
-- 5a uses ecommerce.transaction_id ONLY, on purpose: it shows how often that field is
-- empty. In W1 it is '(not set)' or NULL on every purchase, so 5a returns 0 transactions
-- there. The published transaction and revenue figures come from 5d, which falls back to
-- event_params.transaction_id.
-- Counts compared:  purchase events vs distinct ecommerce.transaction_id, and the
--                   share of transaction IDs that are missing or '(not set)'.
-- Value compared:   ecommerce.purchase_revenue (the field used for reporting)
--                   vs event_params.value (stored as int OR double, so COALESCE both)
--                   vs SUM(items.item_revenue) on the same event.
-- Columns read: event_name, ecommerce, event_params, items (purchase rows only).

WITH p AS (
  SELECT
    IF(_TABLE_SUFFIX <= '20201107', 'W1 Nov 1-7', 'W5 Dec 1-7') AS week,
    ecommerce.transaction_id,
    ecommerce.purchase_revenue,
    (SELECT COALESCE(value.double_value, CAST(value.int_value AS FLOAT64), value.float_value)
       FROM UNNEST(event_params) WHERE key = 'value') AS param_value,
    (SELECT SUM(i.item_revenue) FROM UNNEST(items) AS i) AS items_revenue
  FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
  WHERE (_TABLE_SUFFIX BETWEEN '20201101' AND '20201107' OR _TABLE_SUFFIX BETWEEN '20201201' AND '20201207')
    AND event_name = 'purchase'
)
SELECT
  week,
  COUNT(*) AS purchase_events,
  COUNT(DISTINCT IF(transaction_id IN ('(not set)', ''), NULL, transaction_id)) AS distinct_transactions,
  COUNTIF(transaction_id IS NULL OR transaction_id IN ('(not set)', '')) AS events_without_transaction_id,
  ROUND(SUM(purchase_revenue), 2) AS purchase_revenue,
  ROUND(SUM(param_value), 2) AS param_value,
  ROUND(SUM(items_revenue), 2) AS items_revenue,
  COUNTIF(purchase_revenue IS NULL) AS events_null_revenue,
  COUNTIF(purchase_revenue = 0) AS events_zero_revenue,
  COUNTIF(ABS(IFNULL(purchase_revenue, 0) - IFNULL(param_value, 0)) > 0.01) AS events_revenue_ne_param,
  COUNTIF(ABS(IFNULL(purchase_revenue, 0) - IFNULL(items_revenue, 0)) > 0.01) AS events_revenue_ne_items,
  ROUND(SAFE_DIVIDE(SUM(purchase_revenue), COUNT(DISTINCT IF(transaction_id IN ('(not set)', ''), NULL, transaction_id))), 2) AS revenue_per_transaction
FROM p
GROUP BY week
ORDER BY week;
-- @@
-- 5c. Diagnostics behind 5a: (1) what transaction IDs look like in each week, in both
--     the ecommerce field and the event_params key; (2) the size of the per-event gaps
--     between purchase_revenue and the value param, to tell rounding from real errors.
WITH p AS (
  SELECT
    IF(_TABLE_SUFFIX <= '20201107', 'W1 Nov 1-7', 'W5 Dec 1-7') AS week,
    ecommerce.transaction_id,
    (SELECT COALESCE(value.string_value, CAST(value.int_value AS STRING)) FROM UNNEST(event_params) WHERE key = 'transaction_id') AS param_transaction_id,
    ecommerce.purchase_revenue,
    (SELECT COALESCE(value.double_value, CAST(value.int_value AS FLOAT64), value.float_value)
       FROM UNNEST(event_params) WHERE key = 'value') AS param_value
  FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
  WHERE (_TABLE_SUFFIX BETWEEN '20201101' AND '20201107' OR _TABLE_SUFFIX BETWEEN '20201201' AND '20201207')
    AND event_name = 'purchase'
)
SELECT
  week,
  APPROX_TOP_COUNT(transaction_id, 3) AS top_ecommerce_ids,
  APPROX_TOP_COUNT(param_transaction_id, 3) AS top_param_ids,
  COUNT(DISTINCT param_transaction_id) AS distinct_param_ids,
  ROUND(MAX(ABS(purchase_revenue - param_value)), 2) AS max_gap_revenue_vs_param,
  COUNTIF(ABS(purchase_revenue - param_value) >= 1) AS events_gap_1_or_more,
  COUNTIF(purchase_revenue = ROUND(purchase_revenue)) AS events_whole_number_revenue,
  COUNT(*) AS events
FROM p
GROUP BY week
ORDER BY week;
-- @@
-- 5d. Validated purchase figures. Transaction key = ecommerce.transaction_id when it holds
--     a real value, otherwise event_params.transaction_id (the only ID present in November).
--     Same key as the duplicated-transaction check in checks/run_checks.py.
--     Revenue is counted once per transaction (MAX over its events).
WITH p AS (
  SELECT
    IF(_TABLE_SUFFIX <= '20201107', 'W1 Nov 1-7', 'W5 Dec 1-7') AS week,
    COALESCE(
      IF(ecommerce.transaction_id IN ('(not set)', ''), NULL, ecommerce.transaction_id),
      (SELECT COALESCE(value.string_value, CAST(value.int_value AS STRING)) FROM UNNEST(event_params) WHERE key = 'transaction_id')
    ) AS txn,
    ecommerce.purchase_revenue
  FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
  WHERE (_TABLE_SUFFIX BETWEEN '20201101' AND '20201107' OR _TABLE_SUFFIX BETWEEN '20201201' AND '20201207')
    AND event_name = 'purchase'
),
t AS (
  SELECT week, txn, COUNT(*) AS events, MAX(purchase_revenue) AS revenue_once, SUM(purchase_revenue) AS revenue_naive
  FROM p WHERE txn IS NOT NULL GROUP BY week, txn
)
SELECT
  week,
  (SELECT COUNT(*) FROM p WHERE p.week = t.week) AS purchase_events,
  (SELECT COUNTIF(txn IS NULL) FROM p WHERE p.week = t.week) AS events_without_any_id,
  COUNT(*) AS transactions,
  COUNTIF(events > 1) AS duplicated_transactions,
  ROUND(SUM(revenue_once), 2) AS revenue_validated,
  ROUND(SUM(revenue_naive), 2) AS revenue_naive,
  ROUND(SUM(revenue_once) / COUNT(*), 2) AS revenue_per_transaction
FROM t
GROUP BY week
ORDER BY week;
