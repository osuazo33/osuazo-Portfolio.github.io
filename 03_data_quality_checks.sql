-- Starter data-quality checks for Olist. Replace project and dataset identifiers.
-- Each query returns exceptions; zero rows is expected for checks intended to be clean.

-- 1. Duplicate order identifiers in the order table
SELECT order_id, COUNT(*) AS occurrences
FROM `YOUR_PROJECT.YOUR_DATASET.olist_orders_dataset`
GROUP BY order_id
HAVING COUNT(*) > 1;

-- 2. Order items without a matching order
SELECT i.order_id, COUNT(*) AS item_rows
FROM `YOUR_PROJECT.YOUR_DATASET.olist_order_items_dataset` i
LEFT JOIN `YOUR_PROJECT.YOUR_DATASET.olist_orders_dataset` o USING (order_id)
WHERE o.order_id IS NULL
GROUP BY i.order_id;

-- 3. Invalid or missing item prices
SELECT order_id, order_item_id, price
FROM `YOUR_PROJECT.YOUR_DATASET.olist_order_items_dataset`
WHERE SAFE_CAST(price AS NUMERIC) IS NULL
   OR SAFE_CAST(price AS NUMERIC) < 0;

-- 4. Delivered orders missing delivery date
SELECT order_id, order_status, order_delivered_customer_date
FROM `YOUR_PROJECT.YOUR_DATASET.olist_orders_dataset`
WHERE order_status = 'delivered'
  AND order_delivered_customer_date IS NULL;

-- 5. Payments with invalid values
SELECT order_id, payment_type, payment_value
FROM `YOUR_PROJECT.YOUR_DATASET.olist_order_payments_dataset`
WHERE SAFE_CAST(payment_value AS NUMERIC) IS NULL
   OR SAFE_CAST(payment_value AS NUMERIC) < 0;

-- Document each test's expected result, severity, run timestamp, and owner in your final project.
