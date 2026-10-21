-- Olist source profiling: adjust project/dataset and confirm imported schema.
-- Run each section separately if your SQL editor does not allow multiple statements.

SELECT 'orders' AS table_name, COUNT(*) AS row_count
FROM `YOUR_PROJECT.YOUR_DATASET.olist_orders_dataset`;

SELECT
  COUNT(*) AS row_count,
  COUNTIF(order_id IS NULL) AS null_order_ids,
  COUNT(DISTINCT order_id) AS distinct_order_ids,
  COUNTIF(customer_id IS NULL) AS null_customer_ids
FROM `YOUR_PROJECT.YOUR_DATASET.olist_orders_dataset`;

SELECT
  order_status,
  COUNT(*) AS orders
FROM `YOUR_PROJECT.YOUR_DATASET.olist_orders_dataset`
GROUP BY order_status
ORDER BY orders DESC;

SELECT
  COUNT(*) AS item_rows,
  COUNT(DISTINCT order_id) AS orders_with_items,
  COUNTIF(price IS NULL) AS null_prices,
  COUNTIF(price < 0) AS negative_prices
FROM `YOUR_PROJECT.YOUR_DATASET.olist_order_items_dataset`;

SELECT
  COUNT(*) AS payment_rows,
  COUNTIF(payment_value IS NULL) AS null_payment_values,
  COUNTIF(payment_value < 0) AS negative_payment_values
FROM `YOUR_PROJECT.YOUR_DATASET.olist_order_payments_dataset`;
