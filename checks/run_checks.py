"""Data-quality checks for the GA4 obfuscated ecommerce sample.

Runs four checks over a date window and appends one row per check to a CSV log
(and, optionally, to a BigQuery table). Every query is dry-run first; a query that
would scan more than --max-gb is not executed and is logged with status ERROR.
Any other failure is also logged as ERROR and the remaining checks still run.

    python checks/run_checks.py --project MY_PROJECT                     # first week, 20201101-20201107
    python checks/run_checks.py --project MY_PROJECT --start 20201201 --end 20201207
    python checks/run_checks.py --project MY_PROJECT --bq-table MY_PROJECT.marketing_quality.check_log

--project is the billing project for the queries (or set GOOGLE_CLOUD_PROJECT).

Authentication: Application Default Credentials (gcloud auth application-default login).
Log columns: test_name, run_timestamp, window_start, window_end, status, affected_rows,
severity, resolution, detail, bytes_processed.
"""
import argparse
import csv
import datetime as dt
import pathlib

from google.cloud import bigquery

DATASET = "bigquery-public-data.ga4_obfuscated_sample_ecommerce"
EVENTS = f"`{DATASET}.events_*`"

# Volume baseline: the first four full weeks of the sample, before the December
# peak and the holiday drop. Weekdays and weekends are modelled separately because
# weekend volume is about 35% lower. Range = mean +/- 3 standard deviations.
# Days inside the window being checked are left out of the baseline, so a window
# is never compared against itself.
BASELINE_START, BASELINE_END = "20201101", "20201128"
BASELINE_SIGMAS = 3

LOG_FIELDS = ["test_name", "run_timestamp", "window_start", "window_end", "status",
              "affected_rows", "severity", "resolution", "detail", "bytes_processed"]


class TooExpensive(Exception):
    pass


def run(client, sql, max_gb):
    """Dry-run, enforce the byte limit, then execute. Returns (rows, bytes)."""
    dry = client.query(sql, job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False))
    scanned = dry.total_bytes_processed
    print(f"    dry run: {scanned:,} bytes ({scanned / 1e9:.3f} GB)")
    if scanned > max_gb * 1e9:
        raise TooExpensive(f"dry run {scanned / 1e9:.2f} GB is over the {max_gb} GB limit")
    # maximum_bytes_billed is a second guard in case the real scan differs from the estimate
    job = client.query(sql, job_config=bigquery.QueryJobConfig(maximum_bytes_billed=max(int(max_gb * 1e9), 10_485_760)))
    return list(job.result()), scanned


def window_days(start, end):
    d0, d1 = dt.datetime.strptime(start, "%Y%m%d").date(), dt.datetime.strptime(end, "%Y%m%d").date()
    return [(d0 + dt.timedelta(n)).strftime("%Y%m%d") for n in range((d1 - d0).days + 1)]


def check_missing_user_ids(client, start, end, max_gb):
    rows, scanned = run(client, f"""
        SELECT COUNT(*) AS total_rows, COUNTIF(user_pseudo_id IS NULL) AS missing
        FROM {EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN '{start}' AND '{end}'""", max_gb)
    r = rows[0]
    if r.total_rows == 0:
        return dict(affected_rows=0, status="FAIL", detail="no event rows in the window",
                    resolution="Nothing to check: the window has no data. Run the stale-data check and confirm the load.",
                    bytes_processed=scanned)
    affected = r.missing
    return dict(
        affected_rows=affected,
        detail=f"{affected} of {r.total_rows} event rows have no user_pseudo_id",
        resolution=("No action: every event row has a user identifier." if affected == 0 else
                    "Exclude these rows from user-level metrics and report the share; check the tag / consent setup for the affected days."),
        bytes_processed=scanned)


def check_duplicate_transactions(client, start, end, max_gb):
    # Transaction key: ecommerce.transaction_id when it holds a real value, otherwise the
    # event_params transaction_id. In November 2020 the ecommerce field is '(not set)' or
    # NULL on every purchase and the ID is only present in event_params.
    rows, scanned = run(client, f"""
        WITH p AS (
          SELECT COALESCE(
            IF(ecommerce.transaction_id IN ('(not set)', ''), NULL, ecommerce.transaction_id),
            (SELECT COALESCE(value.string_value, CAST(value.int_value AS STRING))
               FROM UNNEST(event_params) WHERE key = 'transaction_id')) AS txn
          FROM {EVENTS}
          WHERE _TABLE_SUFFIX BETWEEN '{start}' AND '{end}' AND event_name = 'purchase'
        ),
        t AS (SELECT txn, COUNT(*) AS events FROM p WHERE txn IS NOT NULL GROUP BY txn)
        SELECT
          (SELECT COUNT(*) FROM p) AS purchase_events,
          (SELECT COUNTIF(txn IS NULL) FROM p) AS without_id,
          COUNTIF(events > 1) AS duplicated_ids,
          IFNULL(SUM(IF(events > 1, events - 1, 0)), 0) AS extra_events
        FROM t""", max_gb)
    r = rows[0]
    if r.purchase_events == 0:
        return dict(affected_rows=0, status="FAIL", detail="no purchase events in the window",
                    resolution="Nothing to check: confirm the window has data and that purchase tracking is firing.",
                    bytes_processed=scanned)
    affected = r.duplicated_ids
    return dict(
        affected_rows=affected,
        detail=(f"{affected} transaction IDs appear on more than one purchase event "
                f"({r.extra_events} extra events of {r.purchase_events}); {r.without_id} purchase events have no transaction ID in either field"),
        resolution=("No action: one purchase event per transaction ID." if affected == 0 else
                    "Deduplicate on the transaction key before summing revenue (keep one event per ID); count events with no ID separately."),
        bytes_processed=scanned)


def check_event_volume(client, start, end, max_gb):
    # Both queries count rows per daily table without reading any column.
    base_rows, b1 = run(client, f"""
        WITH daily AS (
          SELECT _TABLE_SUFFIX AS suffix, COUNT(*) AS event_rows
          FROM {EVENTS}
          WHERE _TABLE_SUFFIX BETWEEN '{BASELINE_START}' AND '{BASELINE_END}'
            AND _TABLE_SUFFIX NOT BETWEEN '{start}' AND '{end}'
          GROUP BY suffix
        )
        SELECT
          IF(EXTRACT(DAYOFWEEK FROM PARSE_DATE('%Y%m%d', suffix)) IN (1, 7), 'weekend', 'weekday') AS day_type,
          COUNT(*) AS days,
          AVG(event_rows) - {BASELINE_SIGMAS} * STDDEV(event_rows) AS low,
          AVG(event_rows) + {BASELINE_SIGMAS} * STDDEV(event_rows) AS high
        FROM daily
        GROUP BY day_type""", max_gb)
    ranges = {r.day_type: (r.low, r.high, r.days) for r in base_rows if r.low is not None}
    if set(ranges) != {"weekday", "weekend"}:
        raise ValueError("baseline has too few days left once the window is excluded")

    day_rows, b2 = run(client, f"""
        SELECT _TABLE_SUFFIX AS suffix, COUNT(*) AS event_rows
        FROM {EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN '{start}' AND '{end}'
        GROUP BY suffix""", max_gb)
    counts = {r.suffix: r.event_rows for r in day_rows}

    flagged = []
    for day in window_days(start, end):
        kind = "weekend" if dt.datetime.strptime(day, "%Y%m%d").weekday() >= 5 else "weekday"
        low, high, _ = ranges[kind]
        n = counts.get(day, 0)  # a day with no table counts as 0 rows
        if not (low <= n <= high):
            flagged.append(f"{day} ({n:,})")

    detail = (f"baseline {BASELINE_START}-{BASELINE_END} excluding the window, mean +/- {BASELINE_SIGMAS} sd: "
              + "; ".join(f"{k} {lo:,.0f}-{hi:,.0f} ({d} days)" for k, (lo, hi, d) in sorted(ranges.items())))
    if flagged:
        detail += ". Outside: " + ", ".join(flagged)
    return dict(
        affected_rows=len(flagged),
        detail=detail,
        resolution=("No action: daily volume is inside the baseline range." if not flagged else
                    "Review the flagged days: confirm a known cause (campaign, holiday, outage) before using their metrics, and annotate dashboards."),
        bytes_processed=b1 + b2)


def check_stale_data(client, start, end, max_gb):
    # Expected date = the most recent daily table in the dataset, not today's date:
    # the public sample stopped receiving data on 2021-01-31. Also fails on any day of
    # the window with no table or an empty one. __TABLES__ is metadata (no scan).
    rows, scanned = run(client, f"""
        SELECT REGEXP_EXTRACT(table_id, r'^events_(\\d{{8}})$') AS suffix, row_count
        FROM `{DATASET}.__TABLES__`
        WHERE REGEXP_CONTAINS(table_id, r'^events_\\d{{8}}$')""", max_gb)
    tables = {r.suffix: r.row_count for r in rows}
    last = max(tables)
    stale = 0 if tables[last] else 1
    window_missing = [d for d in window_days(start, end) if not tables.get(d)]
    affected = stale + len(window_missing)
    detail = (f"expected date (last table) {last} has {tables[last]:,} rows; "
              f"{len(window_missing)} of {len(window_days(start, end))} window days have no data")
    if window_missing:
        shown = window_missing[:10]
        detail += ": " + ", ".join(shown) + (" ..." if len(window_missing) > 10 else "")
    return dict(
        affected_rows=affected,
        detail=detail,
        resolution=("No action: the latest expected date and every day in the window have data." if affected == 0 else
                    "Hold reporting for the affected dates and re-run the load; alert the data owner if the latest date stays empty."),
        bytes_processed=scanned)


CHECKS = [
    ("missing_user_identifiers", "High", check_missing_user_ids),
    ("duplicated_transaction_ids", "High", check_duplicate_transactions),
    ("unexpected_event_volume", "Medium", check_event_volume),
    ("stale_data", "Medium", check_stale_data),
]


def yyyymmdd(value):
    try:
        dt.datetime.strptime(value, "%Y%m%d")
    except ValueError:
        raise argparse.ArgumentTypeError(f"{value!r} is not a date in YYYYMMDD format")
    return value


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="20201101", type=yyyymmdd, help="first _TABLE_SUFFIX (YYYYMMDD)")
    ap.add_argument("--end", default="20201107", type=yyyymmdd, help="last _TABLE_SUFFIX (YYYYMMDD)")
    ap.add_argument("--project", default=None, help="billing project (default: GOOGLE_CLOUD_PROJECT)")
    ap.add_argument("--max-gb", type=float, default=1.0, help="refuse queries whose dry run exceeds this")
    ap.add_argument("--log", default=str(pathlib.Path(__file__).parent / "logs" / "quality_log.csv"))
    ap.add_argument("--bq-table", default=None, help="optional project.dataset.table to append the log to")
    a = ap.parse_args()
    if a.start > a.end:
        ap.error("--start must not be after --end")

    client = bigquery.Client(project=a.project)
    run_ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    results = []
    for name, severity, fn in CHECKS:
        print(f"[{name}] {a.start}-{a.end}")
        base = dict(test_name=name, run_timestamp=run_ts, window_start=a.start, window_end=a.end, severity=severity)
        try:
            res = fn(client, a.start, a.end, a.max_gb)
            res.setdefault("status", "PASS" if res["affected_rows"] == 0 else "FAIL")
        except TooExpensive as e:
            res = dict(status="ERROR", affected_rows=None, resolution="Not run: narrow the date window or approve the scan.", detail=str(e), bytes_processed=None)
        except Exception as e:  # log the failure and keep running the other checks
            res = dict(status="ERROR", affected_rows=None, resolution="Not run: fix the error and re-run.", detail=f"{type(e).__name__}: {e}"[:500], bytes_processed=None)
        row = {**base, **res}
        results.append(row)
        print(f"    {row['status']}  affected_rows={row['affected_rows']}  {row['detail']}")

    log = pathlib.Path(a.log)
    log.parent.mkdir(parents=True, exist_ok=True)
    new_file = not log.exists()
    with log.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=LOG_FIELDS)
        if new_file:
            w.writeheader()
        w.writerows(results)
    print(f"\nLogged {len(results)} rows to {log}")

    if a.bq_table:
        schema = [bigquery.SchemaField(n, "INTEGER" if n in ("affected_rows", "bytes_processed") else
                                       "TIMESTAMP" if n == "run_timestamp" else "STRING") for n in LOG_FIELDS]
        job = client.load_table_from_json(results, a.bq_table, job_config=bigquery.LoadJobConfig(
            schema=schema, write_disposition="WRITE_APPEND", create_disposition="CREATE_IF_NEEDED"))
        job.result()
        print(f"Appended {len(results)} rows to {a.bq_table}")


if __name__ == "__main__":
    main()
