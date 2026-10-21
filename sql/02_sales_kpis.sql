-- Starter reporting query for Olist.
-- Replace YOUR_PROJECT.YOUR_DATASET. Confirm date types and currency semantics before publishing.
-- Important: item revenue and payment totals are separate measures. Do not sum payment_value
-- after joining it directly to order_items, because multiple items and payments can multiply rows.

WITH order_items AS (
  SELECT
    order_id,
    SUM(SAFE_CAST(price AS NUMERIC)) AS item_revenue,
    SUM(SAFE_CAST(freight_value AS NUMERIC)) AS freight_value,
    COUNT(*) AS item_count
  FROM `YOUR_PROJECT.YOUR_DATASET.olist_order_items_dataset`
  GROUP BY order_id
),
payments AS (
  SELECT
    order_id,
    SUM(SAFE_CAST(payment_value AS NUMERIC)) AS payment_total,
    COUNT(*) AS payment_records
  FROM `YOUR_PROJECT.YOUR_DATASET.olist_order_payments_dataset`
  GROUP BY order_id
),
orders AS (
  SELECT
    order_id,
    customer_id,
    order_status,
    SAFE_CAST(order_purchase_timestamp AS TIMESTAMP) AS purchased_at,
    SAFE_CAST(order_delivered_customer_date AS TIMESTAMP) AS delivered_at,
    SAFE_CAST(order_estimated_delivery_date AS TIMESTAMP) AS estimated_delivery_at
  FROM `YOUR_PROJECT.YOUR_DATASET.olist_orders_dataset`
)
SELECT
  DATE_TRUNC(DATE(o.purchased_at), MONTH) AS order_month,
  COUNT(DISTINCT o.order_id) AS order_count,
  COUNTIF(o.order_status = 'delivered') AS delivered_orders,
  SUM(COALESCE(i.item_revenue, 0)) AS item_revenue,
  SUM(COALESCE(i.freight_value, 0)) AS freight_revenue,
  SUM(COALESCE(p.payment_total, 0)) AS payment_total,
  SAFE_DIVIDE(SUM(COALESCE(i.item_revenue, 0)), COUNT(DISTINCT o.order_id)) AS item_revenue_per_order,
  SAFE_DIVIDE(
    COUNTIF(o.order_status = 'delivered'
      AND o.delivered_at IS NOT NULL
      AND o.estimated_delivery_at IS NOT NULL
      AND o.delivered_at <= o.estimated_delivery_at),
    COUNTIF(o.order_status = 'delivered'
      AND o.delivered_at IS NOT NULL
      AND o.estimated_delivery_at IS NOT NULL)
  ) AS on_time_delivery_rate
FROM orders o
LEFT JOIN order_items i USING (order_id)
LEFT JOIN payments p USING (order_id)
WHERE o.purchased_at IS NOT NULL
GROUP BY order_month
ORDER BY order_month;

-- Suggested view for Looker Studio:
-- CREATE OR REPLACE VIEW `YOUR_PROJECT.YOUR_DATASET.vw_sales_monthly` AS
-- [paste the WITH ... SELECT above, removing the trailing semicolon and ORDER BY]
