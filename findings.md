# Marketing Data Quality: findings

Project: Marketing Attribution & Quality Monitor ([case study](projects/marketing-quality.html)).
Data: `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`, the GA4 export of the
Google Merchandise Store, obfuscated by Google. Queries: [`sql/marketing/`](sql/marketing/).
Checks: [`checks/run_checks.py`](checks/run_checks.py), log in [`checks/logs/quality_log.csv`](checks/logs/quality_log.csv).

Every number below comes from a query in this repo that was dry-run first; the largest single
query scanned 0.27 GB and none needed the 1 GB approval.

## Weeks analysed

| Label | `_TABLE_SUFFIX` | Why |
|---|---|---|
| W1 | 20201101–20201107 | Required starting week: the first 7 days of the sample. |
| W5 | 20201201–20201207 | A full calendar week after `add_to_cart` tracking resumed on 20201126 (see finding 1), so the funnel has all three steps. Cart tracking is still not complete (finding 2). |

The sample has 92 daily tables, 20201101 to 20210131, with no missing day.

## Findings

### 1. `add_to_cart` was not tracked for most of November
`add_to_cart` has 4 rows on 20201101 and **0 rows from 20201102 to 20201115 and from 20201121 to 20201124**,
while `view_item`, `begin_checkout` and `purchase` are present every day. It returns partially on
20201116–20201120 and is stable from 20201126 ([`03a`](sql/marketing/03a_funnel_event_coverage.sql)).
In W1 there are 224 purchasing users and 1 user with an `add_to_cart` event.

**Implication:** any funnel or cart-rate metric for November is a tracking artefact, not behaviour.
**Recommendation:** exclude 20201101–20201125 from cart metrics, or report the funnel from 20201126 onward,
and add an event-presence check per funnel event (proposed below).

### 2. Funnel in a week with complete tracking (W5)

| Level | view_item | add_to_cart (after view) | purchase (after cart) | View→cart | Cart→purchase | View→purchase |
|---|---:|---:|---:|---:|---:|---:|
| Users | 6,780 | 2,296 | 433 | 33.86% | 18.86% | 6.39% |
| Sessions | 7,807 | 2,563 | 414 | 32.83% | 16.15% | 5.30% |

Even in W5, **103 purchasing users (19% of 537) and 140 purchasing sessions have no `add_to_cart` at all**,
so cart tracking is still incomplete (e.g. purchases from "buy now" flows or untagged cart pages).

**Recommendation:** read cart→purchase as a lower bound and audit which pages fire `add_to_cart`.

### 3. Traffic source: a third of first-touch values are obfuscated
- `traffic_source` (user scope, first acquisition) for W1's 20,078 users: **36.8% have at least one obfuscated field**
  (`<Other>` or `(data deleted)`); source alone 31.8%, medium 19.2%, campaign 24.3%.
- `traffic_source` is not stable per user: **3,230 users (16%) show more than one value** in the week,
  because obfuscation is applied per row. The analysis uses the value on each user's first event.
- Session-scope `event_params` source/medium/campaign: present on **74.7% of 25,453 sessions**;
  of those, 24.3% have an obfuscated source and 17.6% an obfuscated campaign.
- The store's own domain `shop.googlemerchandisestore.com / referral` is the source of **4,468 sessions (17.6%)**:
  internal self-referrals that hide the real entry source.

Top W1 sessions by session-scope source (first event in the session that carries one):

| source / medium | sessions | users |
|---|---:|---:|
| (no source param) | 6,434 | 5,543 |
| google / organic | 5,447 | 5,107 |
| shop.googlemerchandisestore.com / referral | 4,468 | 3,762 |
| (direct) / (none) | 3,082 | 2,975 |
| `<Other>` / `<Other>` | 2,017 | 2,001 |
| `<Other>` / referral | 1,527 | 1,469 |
| (data deleted) / (data deleted) | 669 | 623 |
| google / cpc | 634 | 632 |

**Recommendation:** report channel at medium level (less obfuscated), keep `<Other>`/`(data deleted)`
as an explicit bucket, and add the store domain to the referral exclusion list in GA4.

### 4. Purchases: IDs move between fields, a few duplicates, revenue reconciles
| Week | Purchase events | Transactions | Duplicated IDs | Events with no ID | Validated revenue | Naive sum | Revenue / transaction |
|---|---:|---:|---:|---:|---:|---:|---:|
| W1 | 273 | 270 | 3 | 0 | $18,535 | $18,833 | $68.65 |
| W5 | 614 | 580 | 7 | 27 | $39,090 | $39,430 | $67.40 |

- In W1, `ecommerce.transaction_id` is `(not set)` or NULL on **100%** of purchases; the ID only exists in
  `event_params.transaction_id`. In W5 the ecommerce field is filled except for 27 events, which also have
  NULL revenue. Transaction key used: the ecommerce ID when real, otherwise the param ID.
- Duplicated transaction IDs overstate revenue by $298 in W1 (1.6%) and $340 in W5 (0.9%).
- `ecommerce.purchase_revenue`, the `value` param and `SUM(items.item_revenue)` agree within 0.1% in total;
  per-event gaps are at most $0.50 because `purchase_revenue` is stored as whole numbers (rounding from the
  obfuscation), not a calculation error.

### 5. Quality checks
Run with `python checks/run_checks.py --project <billing project> [--start --end]`.

| Check | Severity | W1 result | W5 result |
|---|---|---|---|
| Missing user identifiers | High | PASS, 0 of 328,463 rows | PASS, 0 of 443,706 rows |
| Duplicated transaction IDs | High | **FAIL, 3 IDs** | **FAIL, 7 IDs** (+27 events with no ID) |
| Unexpected event volume | Medium | PASS (baseline without W1's days) | **FAIL, 3 days** above the weekday range (Dec 1, 3, 7: ~71.7k) |
| Stale data | Medium | PASS, 20210131 has 26,489 rows, 0 of 7 window days empty | PASS, 0 of 7 window days empty |

The W5 volume flags are the December peak, not an incident: they show the baseline is seasonal-limited (see decisions).

## Definition decisions

- **Session** = `user_pseudo_id` + `ga_session_id` (int param). `ga_session_id` alone is a timestamp, not unique
  across users. 0 funnel events were missing `ga_session_id` in either week.
- **Funnel, ordered:** a unit reaches add_to_cart if an `add_to_cart` happens at or after its first `view_item`,
  and reaches purchase if a `purchase` happens at or after that `add_to_cart`. Session level is ordered within
  the session. Unordered counts ("reached the step at all") are reported alongside in `03b`.
- **Attribution field:** `traffic_source` for user acquisition (it is first-touch), the session-scope
  `event_params` keys for sessions. `collected_traffic_source` and `session_traffic_source_last_click` do not
  exist in this export. When a session has several source values, the first event that carries one wins (taking
  the MAX string, as a first draft did, biased results toward the store's self-referral).
- **Obfuscated values:** `<Other>` and `(data deleted)`; `(direct)`, `(none)`, `(organic)`, `(referral)` are real GA4 values.
- **Volume baseline:** daily event rows over 20201101–20201128 (four weeks before the December peak),
  separately for weekdays and weekends, range = mean ± 3 SD: **weekday 38,070–69,521, weekend 19,660–51,345**.
  Days inside the window being checked are left out of the baseline, so a window is never compared with itself
  (for W1 the range becomes weekday 38,202–70,202, weekend 18,864–53,950).
- **Stale data:** the expected date is the latest `_TABLE_SUFFIX` in the dataset (20210131), not today's date,
  because the sample stopped updating. The check also fails for any day in the window with no table or an empty
  one, using `__TABLES__` metadata (no scan). A window with no data fails every check instead of passing.
- **No ROAS or CPA:** the dataset contains no campaign spend. They are not calculated.

## Limitations

- Obfuscated sample: values are rounded, some sources are masked, and the data is not representative of a real
  store's absolute volumes. Use it for method, not for business benchmarks.
- The volume baseline uses one month; it flags the December peak and would flag the holiday drop. A production
  version should use a rolling baseline (e.g. trailing 4 weeks by weekday) or a seasonal model.
- Only two weeks were analysed in depth to keep the scan small; other weeks may show different gaps.
- The funnel uses `view_item` as the entry step, so purchases with no product view are outside it.

## Proposed next check
**Funnel event presence (High):** for each day, flag any of `view_item`, `add_to_cart`, `begin_checkout`,
`purchase` with 0 rows while `page_view` is normal. It would have caught finding 1 on 20201102.
