-- Step 3a. Coverage of the funnel events across the whole sample.
-- Why: in the first week add_to_cart appears only on 20201101 (4 rows) while
-- begin_checkout and purchase appear every day. Before defining the funnel we
-- check whether add_to_cart is tracked at all on other dates.
-- Reads only event_date and event_name; dry run is about 0.03 GB for all 92 days.

SELECT
  event_date,
  COUNT(*) AS all_events,
  COUNTIF(event_name = 'view_item') AS view_item,
  COUNTIF(event_name = 'add_to_cart') AS add_to_cart,
  COUNTIF(event_name = 'begin_checkout') AS begin_checkout,
  COUNTIF(event_name = 'purchase') AS purchase
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20210131'
GROUP BY event_date
ORDER BY event_date;
