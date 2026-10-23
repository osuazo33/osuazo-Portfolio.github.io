"""Daily recruiting simulator.

Reads the current state from the database (open and on-hold jobs, queued
requisitions, active applications), advances it with the shared engine in
recruiting_sim.py and writes only what changed. Days are complete calendar days in
Guatemala time: a run simulates every day after the last simulated (or seeded) day
up to yesterday, oldest first, at most `max_days_per_run` per run.

Idempotent: a day already in simulation_runs with status success/seed is never
repeated. Each day runs in its own transaction; if it fails it is rolled back, an
'error' row with the message is written for that day, and the run stops (later
days depend on it). The next run retries the failed day.

    python scripts/simulate_day.py              # catch up to yesterday
    python scripts/simulate_day.py --dry-run    # show the changes, write nothing
"""
import argparse
import datetime as dt
import random
import sys

from db import connect
from recruiting_sim import (ACTIVE_STAGES, APP_COLS, CAND_COLS, CONFIG, EVENT_COLS, JOB_COLS, REQ_COLS,
                            Engine, State, today_gt)

STAT_COLS = ["jobs_published", "jobs_closed", "jobs_on_hold", "applications_created",
             "stage_changes", "hires", "rejections", "withdrawals"]
LOCK_KEY = "recruiting_simulator"


def load_state(cur):
    s = State()
    cur.execute("SELECT recruiter_id, team FROM recruiting.recruiters WHERE is_active")
    s.recruiters = dict(cur.fetchall())

    cur.execute(f"SELECT {', '.join(JOB_COLS)} FROM recruiting.jobs WHERE status IN ('open', 'on_hold')")
    for r in cur.fetchall():
        s.jobs[r[0]] = dict(zip(JOB_COLS, r))
        s.active_by_job[r[0]], s.job_candidates[r[0]] = set(), set()

    cur.execute(f"SELECT {', '.join(REQ_COLS)} FROM recruiting.requisition_queue WHERE status = 'queued'")
    for r in cur.fetchall():
        s.reqs[r[0]] = dict(zip(REQ_COLS, r))

    job_ids = list(s.jobs)
    cur.execute("SELECT job_id, candidate_id FROM recruiting.applications WHERE job_id = ANY(%s)", (job_ids,))
    for job_id, cand in cur.fetchall():
        s.job_candidates[job_id].add(cand)
    cur.execute(f"SELECT {', '.join(APP_COLS)} FROM recruiting.applications "
                "WHERE job_id = ANY(%s) AND current_stage = ANY(%s)", (job_ids, list(ACTIVE_STAGES)))
    for r in cur.fetchall():
        app = dict(zip(APP_COLS, r))
        s.apps[app["application_id"]] = app
        s.active_by_job[app["job_id"]].add(app["application_id"])

    cur.execute("SELECT candidate_id FROM recruiting.candidates ORDER BY candidate_id")
    s.candidate_ids = [r[0] for r in cur.fetchall()]

    # next numeric suffix for each ID family (J0001, REQ0001, A000001, C00001)
    for kind, table, col, prefix in [("job", "jobs", "job_id", 1), ("req", "requisition_queue", "requisition_id", 3),
                                     ("app", "applications", "application_id", 1),
                                     ("cand", "candidates", "candidate_id", 1)]:
        cur.execute(f"SELECT coalesce(max(substr({col}, {prefix + 1})::int), 0) FROM recruiting.{table}")
        s.next_id[kind] = cur.fetchone()[0] + 1
    return s


def persist(cur, s):
    def insert(table, cols, data):
        if data:
            cur.executemany(f"INSERT INTO recruiting.{table} ({', '.join(cols)}) "
                            f"VALUES ({', '.join(['%s'] * len(cols))})", data)

    def update(table, key, cols, data):
        if data:
            sets = ", ".join(f"{c} = %s" for c in cols)
            cur.executemany(f"UPDATE recruiting.{table} SET {sets} WHERE {key} = %s", data)

    def pick(d, cols):
        return tuple(d[c] for c in cols)

    insert("candidates", CAND_COLS, [pick(c, CAND_COLS) for c in s.candidate_rows.values()])
    insert("jobs", JOB_COLS, [pick(s.jobs[j], JOB_COLS) for j in sorted(s.new["jobs"])])
    insert("requisition_queue", REQ_COLS, [pick(s.reqs[r], REQ_COLS) for r in sorted(s.new["reqs"])])
    update("requisition_queue", "requisition_id", ["status", "job_id"],
           [pick(s.reqs[r], ["status", "job_id", "requisition_id"]) for r in sorted(s.dirty["reqs"])])
    job_upd = ["status", "last_updated_at", "closed_at"]
    update("jobs", "job_id", job_upd,
           [pick(s.jobs[j], job_upd + ["job_id"]) for j in sorted(s.dirty["jobs"])])
    insert("applications", APP_COLS, [pick(s.apps[a], APP_COLS) for a in sorted(s.new["apps"])])
    app_upd = APP_COLS[4:]  # current_stage .. last_updated_at
    update("applications", "application_id", app_upd,
           [pick(s.apps[a], app_upd + ["application_id"]) for a in sorted(s.dirty["apps"])])
    insert("application_events", EVENT_COLS, [pick(e, EVENT_COLS) for e in s.events])


def record_run(cur, day, status, stats=None, error=None):
    stats = stats or dict.fromkeys(STAT_COLS, 0)
    cols = STAT_COLS + ["status", "error_message"]
    cur.execute(
        f"""INSERT INTO recruiting.simulation_runs (sim_date, {', '.join(cols)})
            VALUES (%s, {', '.join(['%s'] * len(cols))})
            ON CONFLICT (sim_date) DO UPDATE SET run_at = now(),
              {', '.join(f'{c} = EXCLUDED.{c}' for c in cols)}""",
        (day, *[stats[c] for c in STAT_COLS], status, error))


def simulate(cur, day, verbose):
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (LOCK_KEY,))
    cur.execute("SELECT status FROM recruiting.simulation_runs WHERE sim_date = %s", (day,))
    row = cur.fetchone()
    if row and row[0] in ("success", "seed"):
        print(f"{day}: already simulated ({row[0]}), skipped")
        return None
    s = load_state(cur)
    rng = random.Random(f"{CONFIG['seed_random_seed']}-{day.isoformat()}")
    stats, log = Engine(s, rng).run_day(day, sim_date=day)
    persist(cur, s)
    record_run(cur, day, "success", stats)
    print(f"{day}: " + ", ".join(f"{k}={v}" for k, v in stats.items()))
    for line in log if verbose else log[:12]:
        print(f"    {line}")
    if not verbose and len(log) > 12:
        print(f"    ... {len(log) - 12} more (use --verbose)")
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="run inside a transaction and roll it back")
    ap.add_argument("--verbose", action="store_true", help="print every change, not just the first 12")
    ap.add_argument("--max-days", type=int, default=CONFIG["max_days_per_run"])
    args = ap.parse_args()

    target = today_gt() - dt.timedelta(days=1)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT max(sim_date) FROM recruiting.simulation_runs WHERE status IN ('success', 'seed')")
            last = cur.fetchone()[0]
        conn.rollback()
        if last is None:
            print("No seed found in simulation_runs. Run scripts/seed_data.py first.")
            return 1
        days = []
        day = last + dt.timedelta(days=1)
        while day <= target and len(days) < min(args.max_days, CONFIG["max_days_per_run"]):
            days.append(day)
            day += dt.timedelta(days=1)
        if not days:
            print(f"Up to date: last simulated day is {last}.")
            return 0
        print(f"Simulating {days[0]} .. {days[-1]} ({len(days)} day(s))" + (" [DRY RUN]" if args.dry_run else ""))
        if target - last > dt.timedelta(days=len(days)):
            print(f"  more days pending after {days[-1]}; the next run continues from there")

        for day in days:
            try:
                with conn.cursor() as cur:
                    simulate(cur, day, args.verbose)
                if not args.dry_run:
                    conn.commit()
            except Exception as e:
                conn.rollback()
                msg = f"{type(e).__name__}: {e}"[:1000]
                print(f"{day}: ERROR {msg}")
                if not args.dry_run:
                    with conn.cursor() as cur:
                        record_run(cur, day, "error", error=msg)
                    conn.commit()
                return 1
        if args.dry_run:
            conn.rollback()
            print("dry run: rolled back, nothing written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
