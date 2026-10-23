# Synthetic data: parameters and assumptions

Everything here is invented. The goal is data that behaves like a small recruiting
team (about a dozen open roles, a few hires a month, some neglected vacancies) so the
KPIs, validations and alerts have something real to work on. Parameters are not
calibrated to any real company.

All parameters live in one place: the `CONFIG` block at the top of
[`scripts/recruiting_sim.py`](../../scripts/recruiting_sim.py). The seed and the
daily simulator use the same engine and the same parameters.

## How the seed works

`seed_data.py` starts from an empty state and runs the daily engine over
180 days that end 4 days before today (Guatemala time). It then:

1. tops the requisition queue up to 10, with `scheduled_open_date` in the 30 days
   after the seed end,
2. loads every table in one transaction (COPY), and
3. writes a `simulation_runs` row with `status = 'seed'` for the last seeded day.

The 4-day gap is deliberate: the first simulator run then has three complete days to
catch up (the "simulate 3 days" check in the runbook). Dates are relative to the day
the seed runs; the random seed is fixed (`seed_random_seed = 12`). The engine has no
day-of-week or calendar effects, so the same seed gives the same shape of data on any
run date, shifted in time.

The seed number was chosen from a sweep of 40 seeds as the one closest to the target
volumes that also leaves at least two stale and four aged open vacancies:

| | Target | Seed result (2026-10-22 run) |
|---|---|---|
| Recruiters | ~8 | 8 |
| Jobs | ~60 in 5 departments | 61 |
| Candidates | ~800 | 815 |
| Applications | ~1,500 | 1,517 |
| Queued requisitions | ~10, opening in the next 30 days | 10 |
| Open jobs 45+ days old at seed end | some | 5 |
| Open jobs with no update in 14+ days | some | 2 |

## One simulated day, in order

1. **Requisition queue.** Each queued requisition is cancelled with probability
   0.006/day; otherwise, once `scheduled_open_date ≤ day`, it becomes a job
   (`status = open`) and the requisition is marked `published`. New requisitions
   arrive as a Poisson count with base mean 0.30/day, scaled by
   `1 + (25 − open − queued) / 25` (clamped to 0.25–2), where 25 = target open (13) +
   target queued (12). This feedback keeps the number of open jobs roughly stable.
   Lead time from request to opening: 10–30 days.
2. **Job status.** Per active job per day: open → on_hold 0.003, open → cancelled
   0.0012, on_hold → open 0.06, on_hold → cancelled 0.015. A cancelled job rejects its
   remaining active applications.
3. **Funnel.** Applications that entered their stage before today can move. The daily
   chance of a decision is `decide × ramp`, with `ramp = min(1, 0.4 + 0.6 × days_in_stage / 10)`.
   A decision is advance, reject or withdraw:

   | Stage | decide/day | advance | withdraw | next |
   |---|---|---|---|---|
   | applied | 0.12 | 0.45 | 0.04 | screening |
   | screening | 0.13 | 0.55 | 0.05 | interview |
   | interview | 0.10 | 0.40 | 0.06 | offer |
   | offer | 0.30 | 0.85 (accepted) | 0.15 (declined) | hired |

   `advance` is multiplied by the source factor (referral 1.6, agency 1.3, linkedin
   1.0, career_site 0.9, job_board 0.65, capped at 0.95); `withdraw` grows by
   `days_in_stage / 20`; `reject = 1 − advance − withdraw` (base values) and doubles after
   30 days in a stage. The three weights are then normalized. A declined offer is a
   withdrawal.
4. **Closing.** The first accepted offer fills the job: `closed_at = hired_at`, and
   every other active application on that job is rejected a few minutes later.
5. **New applications.** Each open job receives a Poisson count with mean
   `1.5 × exp(−age_days / 22) + 0.05`, so new jobs get many and old jobs few. Sources:
   linkedin 35%, job_board 25%, career_site 18%, referral 12%, agency 10%. 53% of
   applications come from a new candidate; the rest reuse an existing candidate who
   has not applied to that job and was created before this application.

**Forgotten vacancies.** 20% of jobs (chosen from a hash of `job_id`, so no extra
column is needed) have one window, starting 4–25 days after opening and lasting
25–50 days, where nothing happens to them: no applications, no stage changes, no
status changes. That is what produces real "no update in 14+ days" alerts. Activity
resumes after the window.

## Other assumptions

- Days are Guatemala calendar days (UTC-6, no daylight saving). Events happen between
  08:00 and 18:00 local time; an event that must follow another on the same day is
  placed 1–45 minutes after it.
- The simulator only simulates complete days, up to yesterday, so it never writes a
  timestamp in the future.
- The random generator for each simulated day is seeded with `seed_random_seed` and
  the date, so re-running the same day from the same state gives the same result
  (useful with `--dry-run`).
- Candidates have only `candidate_id`, `region` (Guatemala 55%, El Salvador 12%,
  Honduras 10%, Costa Rica 8%, Mexico 7%, remote/other 8%) and `created_at`.
- Recruiters belong to a team that matches the department of their jobs: Tech
  (Engineering, 3 recruiters), Commercial (Sales, Customer Success, 3), Corporate
  (Operations, Finance, 2).
