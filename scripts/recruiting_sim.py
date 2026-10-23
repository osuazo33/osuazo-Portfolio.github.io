"""Synthetic recruiting engine shared by seed_data.py and simulate_day.py.

The engine holds the working state in memory (jobs, requisitions, active
applications, candidates) and advances it one calendar day at a time. The seed runs
it over 180 days from an empty state and bulk-loads the result; the daily simulator
loads the current state from the database, runs the missing days and writes only the
rows that changed. Both therefore follow exactly the same rules and parameters.

Every parameter lives in CONFIG. Days are calendar days in Guatemala time (UTC-6,
no daylight saving), and every event happens during business hours of its day.
"""
import datetime as dt
import math
import zlib

GT = dt.timezone(dt.timedelta(hours=-6), "America/Guatemala")

CONFIG = {
    # --- seed ---------------------------------------------------------------
    "seed_random_seed": 12,            # picked from a 40-seed sweep as close to the target volumes
    "seed_history_days": 180,         # days of history the seed generates
    "seed_lag_days": 4,               # seed ends at today - 4; the simulator fills the rest
    "bootstrap_jobs": 12,             # jobs opened during the first days of the history
    "bootstrap_spread_days": 10,
    "seed_queue_size": 10,            # queue topped up to this at the end, opening in the next 30 days
    "recruiters": {"Tech": 3, "Commercial": 3, "Corporate": 2},

    # --- simulator ----------------------------------------------------------
    "max_days_per_run": 30,

    # --- departments, teams and titles --------------------------------------
    "departments": {  # department: (weight, recruiting team, titles)
        "Engineering":      (0.30, "Tech", ["Backend Engineer", "Frontend Engineer", "Data Engineer",
                                            "QA Analyst", "DevOps Engineer", "Data Analyst"]),
        "Sales":            (0.25, "Commercial", ["Account Executive", "Sales Development Rep",
                                                  "Key Account Manager"]),
        "Customer Success": (0.15, "Commercial", ["Customer Success Manager", "Support Specialist"]),
        "Operations":       (0.20, "Corporate", ["Operations Analyst", "Logistics Coordinator",
                                                 "Procurement Specialist"]),
        "Finance":          (0.10, "Corporate", ["Financial Analyst", "Accountant", "Payroll Specialist"]),
    },
    "regions": {"Guatemala": 0.55, "El Salvador": 0.12, "Honduras": 0.10, "Costa Rica": 0.08,
                "Mexico": 0.07, "Remote / other": 0.08},

    # --- requisition queue --------------------------------------------------
    "target_open_jobs": 13,           # the queue inflow reacts to keep open jobs near this
    "target_queued": 12,
    "new_requisitions_per_day": 0.30, # base rate, scaled by the gap to the targets
    "queue_lead_days": (10, 30),      # requested -> scheduled_open_date
    "requisition_cancel_per_day": 0.006,

    # --- job status changes (per job per day, active jobs only) -------------
    "job_on_hold_per_day": 0.003,
    "job_resume_per_day": 0.06,       # on_hold -> open
    "job_cancel_open_per_day": 0.0012,
    "job_cancel_hold_per_day": 0.015,

    # --- forgotten jobs: no activity at all for a few weeks -----------------
    # Chosen deterministically from the job_id, so no extra column is needed.
    "forgotten_share": 0.20,
    "forgotten_start_after_days": (4, 25),
    "forgotten_length_days": (25, 50),

    # --- application inflow (per open job per day) --------------------------
    # expected applications = peak * exp(-age / decay) + floor: new jobs get more.
    "apps_peak_per_day": 1.5,
    "apps_decay_days": 22,
    "apps_floor_per_day": 0.05,
    "new_candidate_share": 0.53,      # otherwise an existing candidate applies again
    "sources": {"linkedin": 0.35, "job_board": 0.25, "career_site": 0.18,
                "referral": 0.12, "agency": 0.10},

    # --- funnel -------------------------------------------------------------
    # Each day an active application gets a decision with probability `decide`,
    # scaled by days in the stage (slow at first, full rate after `ramp_days`).
    # A decision is advance / reject / withdraw; `advance` is multiplied by the
    # source factor and the rest is split between reject and withdraw.
    "stages": {
        "applied":   {"next": "screening", "decide": 0.12, "advance": 0.45, "withdraw": 0.04},
        "screening": {"next": "interview", "decide": 0.13, "advance": 0.55, "withdraw": 0.05},
        "interview": {"next": "offer",     "decide": 0.10, "advance": 0.40, "withdraw": 0.06},
        "offer":     {"next": "hired",     "decide": 0.30, "advance": 0.85, "withdraw": 0.15},
    },
    "stage_ramp_days": 10,
    "stale_stage_days": 30,           # after this, rejection weight doubles
    "source_advance_factor": {"referral": 1.6, "agency": 1.3, "linkedin": 1.0,
                              "career_site": 0.9, "job_board": 0.65},
}

ACTIVE_STAGES = ("applied", "screening", "interview", "offer")
STAGE_COLUMN = {"applied": "applied_at", "screening": "screened_at", "interview": "interviewed_at",
                "offer": "offer_at", "hired": "hired_at", "rejected": "rejected_at"}

JOB_COLS = ["job_id", "title", "department", "recruiter_id", "status", "created_at",
            "last_updated_at", "closed_at"]
REQ_COLS = ["requisition_id", "title", "department", "recruiter_id", "requested_at",
            "scheduled_open_date", "status", "job_id"]
APP_COLS = ["application_id", "candidate_id", "job_id", "source", "current_stage", "applied_at",
            "screened_at", "interviewed_at", "offer_at", "hired_at", "rejected_at", "last_updated_at"]
CAND_COLS = ["candidate_id", "region", "created_at"]
EVENT_COLS = ["application_id", "from_stage", "to_stage", "event_at", "sim_date"]


def today_gt():
    return dt.datetime.now(GT).date()


def weighted(rng, weights):
    keys = list(weights)
    return rng.choices(keys, weights=[weights[k] for k in keys])[0]


def poisson(rng, lam):
    # Knuth; lam stays small here
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def is_forgotten(job_id, created_at, day, cfg=CONFIG):
    """True while a job is in its 'forgotten' window: nobody touches it."""
    h = zlib.crc32(job_id.encode())
    if (h % 1000) / 1000 >= cfg["forgotten_share"]:
        return False
    lo, hi = cfg["forgotten_start_after_days"]
    start = created_at.astimezone(GT).date() + dt.timedelta(days=lo + (h // 1000) % (hi - lo + 1))
    llo, lhi = cfg["forgotten_length_days"]
    length = llo + (h // 100000) % (lhi - llo + 1)
    return start <= day < start + dt.timedelta(days=length)


class State:
    """Working state plus change tracking. Rows are plain dicts keyed like the tables."""

    def __init__(self):
        self.recruiters = {}       # recruiter_id -> team
        self.jobs = {}             # open / on_hold jobs (+ any job touched in this run)
        self.reqs = {}             # queued requisitions (+ any touched)
        self.apps = {}             # active applications (+ any touched)
        self.active_by_job = {}    # job_id -> set(application_id) in an active stage
        self.job_candidates = {}   # job_id -> set(candidate_id), to keep (candidate, job) unique
        self.candidate_ids = []    # pool for repeat applicants
        self.candidate_rows = {}   # new candidates only
        self.events = []
        self.next_id = {"job": 1, "req": 1, "app": 1, "cand": 1}
        self.new = {"jobs": set(), "reqs": set(), "apps": set()}
        self.dirty = {"jobs": set(), "reqs": set(), "apps": set()}

    def new_id(self, kind):
        n = self.next_id[kind]
        self.next_id[kind] += 1
        return {"job": f"J{n:04d}", "req": f"REQ{n:04d}", "app": f"A{n:06d}", "cand": f"C{n:05d}"}[kind]

    def touch(self, table, key):
        if key not in self.new[table]:
            self.dirty[table].add(key)


class Engine:
    def __init__(self, state, rng, cfg=CONFIG):
        self.s, self.rng, self.cfg = state, rng, cfg

    # --- helpers ------------------------------------------------------------
    def time_on(self, day, after=None):
        """A random business-hours timestamp on `day`, strictly after `after` if given."""
        t = dt.datetime.combine(day, dt.time(8), GT) + dt.timedelta(seconds=self.rng.randint(0, 10 * 3600))
        if after is not None and t <= after:
            t = after + dt.timedelta(minutes=self.rng.randint(1, 45))
        return t

    def touch_job(self, job, t):
        job["last_updated_at"] = max(job["last_updated_at"], t)
        self.s.touch("jobs", job["job_id"])

    def event(self, app, to_stage, t, sim_date):
        frm = app["current_stage"]
        self.s.events.append({"application_id": app["application_id"],
                              "from_stage": None if to_stage == "applied" else frm,
                              "to_stage": to_stage, "event_at": t, "sim_date": sim_date})
        app["current_stage"] = to_stage
        app["last_updated_at"] = t
        if to_stage in STAGE_COLUMN:
            app[STAGE_COLUMN[to_stage]] = t
        if to_stage not in ACTIVE_STAGES:
            self.s.active_by_job[app["job_id"]].discard(app["application_id"])
        self.s.touch("apps", app["application_id"])

    def close_job(self, job, status, t, stats, sim_date):
        job["status"], job["closed_at"] = status, t
        self.touch_job(job, t)
        stats["jobs_closed"] += 1
        for app_id in sorted(self.s.active_by_job.get(job["job_id"], ())):
            app = self.s.apps[app_id]
            rt = max(t, app["last_updated_at"]) + dt.timedelta(minutes=self.rng.randint(1, 90))
            self.event(app, "rejected", rt, sim_date)
            stats["rejections"] += 1
            stats["stage_changes"] += 1
            self.touch_job(job, rt)

    def stage_entered(self, app):
        return app[STAGE_COLUMN[app["current_stage"]]]

    # --- one simulated day --------------------------------------------------
    def run_day(self, day, sim_date=None):
        """Advance the state by one day. sim_date is stored on events (None for the seed)."""
        cfg, rng, s = self.cfg, self.rng, self.s
        stats = dict.fromkeys(["jobs_published", "jobs_closed", "jobs_on_hold", "applications_created",
                               "stage_changes", "hires", "rejections", "withdrawals"], 0)
        log = []

        # 1. requisition queue: cancellations, publications, new requisitions
        for req in sorted((r for r in s.reqs.values() if r["status"] == "queued"),
                          key=lambda r: r["requisition_id"]):
            if rng.random() < cfg["requisition_cancel_per_day"]:
                req["status"] = "cancelled"
                s.touch("reqs", req["requisition_id"])
                log.append(f"requisition {req['requisition_id']} cancelled before publishing")
            elif req["scheduled_open_date"] <= day:
                t = self.time_on(day)
                job_id = s.new_id("job")
                s.jobs[job_id] = {"job_id": job_id, "title": req["title"], "department": req["department"],
                                  "recruiter_id": req["recruiter_id"], "status": "open", "created_at": t,
                                  "last_updated_at": t, "closed_at": None}
                s.new["jobs"].add(job_id)
                s.active_by_job[job_id], s.job_candidates[job_id] = set(), set()
                req["status"], req["job_id"] = "published", job_id
                s.touch("reqs", req["requisition_id"])
                stats["jobs_published"] += 1
                log.append(f"{req['requisition_id']} published as {job_id} ({req['title']})")

        open_now = sum(j["status"] == "open" for j in s.jobs.values())
        queued = sum(r["status"] == "queued" for r in s.reqs.values())
        target = cfg["target_open_jobs"] + cfg["target_queued"]
        scale = min(2.0, max(0.25, 1 + (target - open_now - queued) / target))
        for _ in range(poisson(rng, cfg["new_requisitions_per_day"] * scale)):
            lo, hi = cfg["queue_lead_days"]
            req = self.add_requisition(day, day + dt.timedelta(days=rng.randint(lo, hi)))
            log.append(f"{req['requisition_id']} queued for {req['scheduled_open_date']} ({req['title']})")

        # 2. job status changes (forgotten jobs are untouched)
        for job in sorted(s.jobs.values(), key=lambda j: j["job_id"]):
            if job["status"] not in ("open", "on_hold") or job["created_at"].astimezone(GT).date() == day:
                continue
            if is_forgotten(job["job_id"], job["created_at"], day, cfg):
                continue
            r = rng.random()
            if job["status"] == "open":
                if r < cfg["job_cancel_open_per_day"]:
                    self.close_job(job, "cancelled", self.time_on(day, job["last_updated_at"]), stats, sim_date)
                    log.append(f"{job['job_id']} cancelled")
                elif r < cfg["job_cancel_open_per_day"] + cfg["job_on_hold_per_day"]:
                    job["status"] = "on_hold"
                    self.touch_job(job, self.time_on(day, job["last_updated_at"]))
                    stats["jobs_on_hold"] += 1
                    log.append(f"{job['job_id']} put on hold")
            else:
                if r < cfg["job_cancel_hold_per_day"]:
                    self.close_job(job, "cancelled", self.time_on(day, job["last_updated_at"]), stats, sim_date)
                    log.append(f"{job['job_id']} cancelled while on hold")
                elif r < cfg["job_cancel_hold_per_day"] + cfg["job_resume_per_day"]:
                    job["status"] = "open"
                    self.touch_job(job, self.time_on(day, job["last_updated_at"]))
                    log.append(f"{job['job_id']} back from hold")

        # 3. funnel movement for applications that entered their stage before today
        start_of_day = dt.datetime.combine(day, dt.time(0), GT)
        for job in sorted(s.jobs.values(), key=lambda j: j["job_id"]):
            if job["status"] != "open" or is_forgotten(job["job_id"], job["created_at"], day, cfg):
                continue
            app_ids = sorted(s.active_by_job.get(job["job_id"], ()))
            rng.shuffle(app_ids)
            for app_id in app_ids:
                if job["status"] != "open":
                    break  # filled by an earlier hire today; close_job rejected the rest
                app = s.apps[app_id]
                if app["current_stage"] not in ACTIVE_STAGES:
                    continue
                entered = self.stage_entered(app)
                if entered >= start_of_day:
                    continue
                days_in = (start_of_day - entered).days
                st = cfg["stages"][app["current_stage"]]
                ramp = min(1.0, 0.4 + 0.6 * days_in / cfg["stage_ramp_days"])
                if rng.random() >= st["decide"] * ramp:
                    continue
                adv = min(0.95, st["advance"] * cfg["source_advance_factor"][app["source"]])
                wd = st["withdraw"] * (1 + days_in / 20)
                rej = max(0.0, 1 - st["advance"] - st["withdraw"])
                if days_in > cfg["stale_stage_days"]:
                    rej *= 2
                total = adv + wd + rej
                r = rng.random() * total
                t = self.time_on(day, app["last_updated_at"])
                if r < adv:
                    nxt = st["next"]
                    self.event(app, nxt, t, sim_date)
                    stats["stage_changes"] += 1
                    self.touch_job(job, t)
                    if nxt == "hired":
                        stats["hires"] += 1
                        log.append(f"{app_id} hired -> {job['job_id']} filled")
                        self.close_job(job, "filled", t, stats, sim_date)
                elif r < adv + wd:
                    self.event(app, "withdrawn", t, sim_date)
                    stats["withdrawals"] += 1
                    stats["stage_changes"] += 1
                    self.touch_job(job, t)
                else:
                    self.event(app, "rejected", t, sim_date)
                    stats["rejections"] += 1
                    stats["stage_changes"] += 1
                    self.touch_job(job, t)

        # 4. new applications: more for young jobs, fewer for old ones
        for job in sorted(s.jobs.values(), key=lambda j: j["job_id"]):
            if job["status"] != "open" or is_forgotten(job["job_id"], job["created_at"], day, cfg):
                continue
            age = (day - job["created_at"].astimezone(GT).date()).days
            lam = cfg["apps_peak_per_day"] * math.exp(-age / cfg["apps_decay_days"]) + cfg["apps_floor_per_day"]
            for _ in range(poisson(rng, lam)):
                after = job["created_at"] if age == 0 else None
                self.add_application(job, self.time_on(day, after), sim_date)
                stats["applications_created"] += 1

        return stats, log

    # --- creators -----------------------------------------------------------
    def add_requisition(self, day, scheduled, requested_at=None):
        cfg, rng, s = self.cfg, self.rng, self.s
        dept = weighted(rng, {d: v[0] for d, v in cfg["departments"].items()})
        _, team, titles = cfg["departments"][dept]
        recruiters = sorted(r for r, tm in s.recruiters.items() if tm == team)
        req_id = s.new_id("req")
        s.reqs[req_id] = {"requisition_id": req_id, "title": rng.choice(titles), "department": dept,
                          "recruiter_id": rng.choice(recruiters),
                          "requested_at": requested_at or self.time_on(day),
                          "scheduled_open_date": scheduled, "status": "queued", "job_id": None}
        s.new["reqs"].add(req_id)
        return s.reqs[req_id]

    def add_application(self, job, t, sim_date):
        cfg, rng, s = self.cfg, self.rng, self.s
        taken = s.job_candidates.setdefault(job["job_id"], set())
        cand = None
        if s.candidate_ids and rng.random() >= cfg["new_candidate_share"]:
            for _ in range(5):
                c = rng.choice(s.candidate_ids)
                # candidates created in this run must exist before they apply again
                new_row = s.candidate_rows.get(c)
                if c not in taken and (new_row is None or new_row["created_at"] < t):
                    cand = c
                    break
        if cand is None:
            cand = s.new_id("cand")
            s.candidate_rows[cand] = {"candidate_id": cand, "region": weighted(rng, cfg["regions"]),
                                      "created_at": t}
            s.candidate_ids.append(cand)
        taken.add(cand)
        app_id = s.new_id("app")
        app = {c: None for c in APP_COLS}
        app.update(application_id=app_id, candidate_id=cand, job_id=job["job_id"],
                   source=weighted(rng, cfg["sources"]), current_stage="applied",
                   applied_at=t, last_updated_at=t)
        s.apps[app_id] = app
        s.new["apps"].add(app_id)
        s.active_by_job.setdefault(job["job_id"], set()).add(app_id)
        self.event(app, "applied", t, sim_date)
        self.touch_job(job, t)
        return app
