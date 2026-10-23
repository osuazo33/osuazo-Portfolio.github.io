"""Initial load of the synthetic recruiting data.

Runs the shared engine (recruiting_sim.py) from an empty state over the last
`seed_history_days` days, ending `seed_lag_days` before today (Guatemala time), and
loads the result in one transaction. It also writes a 'seed' row to
simulation_runs so simulate_day.py starts on the following day.

    python scripts/seed_data.py --dry-run     # generate and print the summary only
    python scripts/seed_data.py --reset       # TRUNCATE the data tables, then load

Without --reset it refuses to run if the tables already hold data.
--reset never touches recruiting.automation_runs (the n8n log).
"""
import argparse
import datetime as dt
import random
import sys
from collections import Counter

from db import connect
from recruiting_sim import (APP_COLS, CAND_COLS, CONFIG, EVENT_COLS, GT, JOB_COLS, REQ_COLS,
                            Engine, State, today_gt)

DATA_TABLES = ["application_events", "applications", "candidates", "requisition_queue",
               "jobs", "recruiters", "simulation_runs"]


def generate(end):
    cfg = CONFIG
    rng = random.Random(cfg["seed_random_seed"])
    s = State()
    eng = Engine(s, rng)
    day0 = end - dt.timedelta(days=cfg["seed_history_days"] - 1)
    created = dt.datetime.combine(day0, dt.time(7), GT)

    n = 1
    for team, count in cfg["recruiters"].items():
        for _ in range(count):
            s.recruiters[f"R{n:02d}"] = team
            n += 1

    for _ in range(cfg["bootstrap_jobs"]):
        eng.add_requisition(day0, day0 + dt.timedelta(days=rng.randint(0, cfg["bootstrap_spread_days"])),
                            requested_at=created)

    totals = Counter()
    day = day0
    while day <= end:
        stats, _ = eng.run_day(day)
        totals.update(stats)
        day += dt.timedelta(days=1)

    # Top the queue up so the simulator has requisitions to publish next month.
    queued = sum(r["status"] == "queued" for r in s.reqs.values())
    for _ in range(cfg["seed_queue_size"] - queued):
        requested = end - dt.timedelta(days=rng.randint(0, 14))
        eng.add_requisition(requested, end + dt.timedelta(days=rng.randint(1, 30)),
                            requested_at=eng.time_on(requested))
    return s, totals, created


def summarize(s, end):
    as_of = dt.datetime.combine(end + dt.timedelta(days=1), dt.time(0), GT)
    jobs = list(s.jobs.values())
    open_jobs = [j for j in jobs if j["status"] == "open"]
    print(f"seed covers {end - dt.timedelta(days=CONFIG['seed_history_days'] - 1)} .. {end}")
    print(f"recruiters {len(s.recruiters)}, jobs {len(jobs)}, candidates {len(s.candidate_rows)}, "
          f"applications {len(s.apps)}, events {len(s.events)}")
    print("jobs by status:", dict(Counter(j["status"] for j in jobs)))
    print("requisitions by status:", dict(Counter(r["status"] for r in s.reqs.values())))
    print("applications by stage:", dict(Counter(a["current_stage"] for a in s.apps.values())))
    print("jobs by department:", dict(Counter(j["department"] for j in jobs)))
    aged = [j["job_id"] for j in open_jobs if (as_of - j["created_at"]).days >= 45]
    stale = [j["job_id"] for j in open_jobs if (as_of - j["last_updated_at"]).days >= 14]
    print(f"open jobs {len(open_jobs)}: aged >= 45 days {len(aged)} {aged}; "
          f"no update >= 14 days {len(stale)} {stale}")
    by_src = Counter(a["source"] for a in s.apps.values())
    hired = Counter(a["source"] for a in s.apps.values() if a["hired_at"])
    print("hires / applications by source:", {k: f"{hired[k]}/{v}" for k, v in by_src.items()})


def rows(dicts, cols):
    return [tuple(d[c] for c in cols) for d in dicts]


def load(conn, s, totals, created, end):
    with conn.cursor() as cur:
        def copy(table, cols, data):
            with cur.copy(f"COPY recruiting.{table} ({', '.join(cols)}) FROM STDIN") as cp:
                for r in data:
                    cp.write_row(r)

        copy("recruiters", ["recruiter_id", "team", "is_active", "created_at"],
             [(r, team, True, created) for r, team in sorted(s.recruiters.items())])
        copy("jobs", JOB_COLS, rows(s.jobs.values(), JOB_COLS))
        copy("requisition_queue", REQ_COLS, rows(s.reqs.values(), REQ_COLS))
        copy("candidates", CAND_COLS, rows(s.candidate_rows.values(), CAND_COLS))
        copy("applications", APP_COLS, rows(s.apps.values(), APP_COLS))
        copy("application_events", EVENT_COLS, rows(s.events, EVENT_COLS))
        cur.execute(
            """INSERT INTO recruiting.simulation_runs
                 (sim_date, jobs_published, jobs_closed, jobs_on_hold, applications_created,
                  stage_changes, hires, rejections, withdrawals, status, error_message)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'seed', %s)""",
            (end, totals["jobs_published"], totals["jobs_closed"], totals["jobs_on_hold"],
             totals["applications_created"], totals["stage_changes"], totals["hires"],
             totals["rejections"], totals["withdrawals"],
             f"seed: {CONFIG['seed_history_days']} days of history, totals for the whole period"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reset", action="store_true", help="TRUNCATE the data tables before loading")
    ap.add_argument("--dry-run", action="store_true", help="generate and summarize, write nothing")
    args = ap.parse_args()

    end = today_gt() - dt.timedelta(days=CONFIG["seed_lag_days"])
    s, totals, created = generate(end)
    summarize(s, end)
    if args.dry_run:
        print("\ndry run: nothing written")
        return 0

    with connect() as conn:
        with conn.cursor() as cur:
            counts = {}
            for t in DATA_TABLES:
                cur.execute(f"SELECT count(*) FROM recruiting.{t}")
                counts[t] = cur.fetchone()[0]
            if any(counts.values()):
                if not args.reset:
                    print(f"\nTables already hold data {counts}. Re-run with --reset to replace them.")
                    return 1
                # automation_runs is deliberately not in this list
                cur.execute("TRUNCATE " + ", ".join(f"recruiting.{t}" for t in DATA_TABLES)
                            + " RESTART IDENTITY")
                print(f"\ntruncated {', '.join(DATA_TABLES)}")
        load(conn, s, totals, created, end)
        conn.commit()
    print("loaded and committed in one transaction")
    return 0


if __name__ == "__main__":
    sys.exit(main())
