-- Step 6. Recruiting KPIs (PostgreSQL / Supabase).
-- Run with: python scripts/run_sql.py sql/recruiting/06_kpis.sql
--
-- Reporting date (as_of): the moment the query runs, now(). Day counts are whole
-- days, floor((as_of - start) / 1 day). Every KPI below has one numerator and one
-- denominator, written next to it.
--
-- Conversion cohort: applications submitted from 180 days before as_of up to
-- 30 days before as_of. The last 30 days are left out because those applications
-- have not had time to reach interview or hire yet; counting them would push the
-- rates down for a reason that has nothing to do with performance.

-- @@ 6a. Headline KPIs as of the reporting date
WITH p AS (SELECT now() AS as_of),
filled AS (
  -- Time-to-fill: days from jobs.created_at to the first applications.hired_at
  -- (accepted offer). Filled jobs only; open or cancelled jobs are excluded.
  SELECT j.job_id,
         extract(epoch FROM min(a.hired_at) - j.created_at) / 86400.0 AS days_to_fill
  FROM recruiting.jobs j
  JOIN recruiting.applications a ON a.job_id = j.job_id AND a.hired_at IS NOT NULL
  WHERE j.status = 'filled'
  GROUP BY j.job_id, j.created_at
),
cohort AS (
  SELECT a.* FROM recruiting.applications a, p
  WHERE a.applied_at >= p.as_of - interval '180 days'
    AND a.applied_at <  p.as_of - interval '30 days'
)
SELECT
  to_char((SELECT as_of FROM p) AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI') AS as_of_guatemala,
  -- Open vacancies: jobs whose status is 'open' at the reporting date. on_hold is
  -- shown separately and is not counted as open.
  (SELECT count(*) FROM recruiting.jobs WHERE status = 'open')    AS open_vacancies,
  (SELECT count(*) FROM recruiting.jobs WHERE status = 'on_hold') AS on_hold_vacancies,
  (SELECT count(*) FROM filled)                                   AS filled_jobs_n,
  (SELECT round(avg(days_to_fill)::numeric, 1) FROM filled)       AS time_to_fill_avg_days,
  (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_fill))::numeric, 1)
     FROM filled)                                                 AS time_to_fill_median_days,
  -- Application-to-interview: distinct applications with interviewed_at /
  -- distinct applications in the cohort (all of them are eligible).
  (SELECT count(DISTINCT application_id) FROM cohort)             AS cohort_applications,
  (SELECT count(DISTINCT application_id) FROM cohort WHERE interviewed_at IS NOT NULL) AS cohort_interviews,
  (SELECT round(100.0 * count(DISTINCT application_id) FILTER (WHERE interviewed_at IS NOT NULL)
                / nullif(count(DISTINCT application_id), 0), 1) FROM cohort) AS app_to_interview_pct,
  -- Interview-to-hire: applications with hired_at / applications with interviewed_at,
  -- same cohort. hired_at requires offer_at, which requires interviewed_at, so the
  -- numerator is always a subset of the denominator.
  (SELECT count(DISTINCT application_id) FROM cohort WHERE hired_at IS NOT NULL) AS cohort_hires,
  (SELECT round(100.0 * count(DISTINCT application_id) FILTER (WHERE hired_at IS NOT NULL)
                / nullif(count(DISTINCT application_id) FILTER (WHERE interviewed_at IS NOT NULL), 0), 1)
     FROM cohort)                                                 AS interview_to_hire_pct,
  -- Stale updates: open jobs whose last_updated_at is more than 14 days before as_of.
  (SELECT count(*) FROM recruiting.jobs, p
    WHERE status = 'open' AND last_updated_at < p.as_of - interval '14 days') AS stale_open_vacancies;

-- @@ 6b. Vacancy aging buckets (open jobs only; age = as_of - created_at in whole days)
WITH p AS (SELECT now() AS as_of),
buckets(ord, bucket, lo, hi) AS (
  VALUES (1, '0-15', 0, 15), (2, '16-30', 16, 30), (3, '31-45', 31, 45),
         (4, '46-60', 46, 60), (5, '60+', 61, 100000)
),
ages AS (
  SELECT floor(extract(epoch FROM p.as_of - j.created_at) / 86400)::int AS age_days
  FROM recruiting.jobs j, p WHERE j.status = 'open'
)
SELECT b.bucket, count(a.age_days) AS open_vacancies
FROM buckets b LEFT JOIN ages a ON a.age_days BETWEEN b.lo AND b.hi
GROUP BY b.ord, b.bucket
ORDER BY b.ord;

-- @@ 6c. Stale open vacancies (no update in more than 14 days)
SELECT j.job_id, j.title, j.department, j.recruiter_id,
       floor(extract(epoch FROM now() - j.created_at) / 86400)::int      AS days_open,
       floor(extract(epoch FROM now() - j.last_updated_at) / 86400)::int AS days_since_update
FROM recruiting.jobs j
WHERE j.status = 'open' AND j.last_updated_at < now() - interval '14 days'
ORDER BY days_since_update DESC;

-- @@ 6d. Source effectiveness (conversion cohort), with n beside each rate
-- n for app_to_interview is cohort applications; n for interview_to_hire is
-- interviews. Any rate whose n is below 30 is flagged: it is too small to compare.
WITH p AS (SELECT now() AS as_of),
cohort AS (
  SELECT a.* FROM recruiting.applications a, p
  WHERE a.applied_at >= p.as_of - interval '180 days'
    AND a.applied_at <  p.as_of - interval '30 days'
)
SELECT source,
       count(*)                                   AS applications_n,
       count(interviewed_at)                      AS interviews_n,
       count(hired_at)                            AS hires,
       round(100.0 * count(interviewed_at) / nullif(count(*), 0), 1)            AS app_to_interview_pct,
       round(100.0 * count(hired_at) / nullif(count(interviewed_at), 0), 1)     AS interview_to_hire_pct,
       round(100.0 * count(hired_at) / nullif(count(*), 0), 1)                  AS app_to_hire_pct,
       CASE WHEN count(*) < 30 THEN 'n < 30: applications'
            WHEN count(interviewed_at) < 30 THEN 'n < 30: interview_to_hire'
            ELSE '' END                           AS sample_warning
FROM cohort
GROUP BY source
ORDER BY app_to_hire_pct DESC;

-- @@ 6e. Time-to-fill by department (filled jobs only)
WITH filled AS (
  SELECT j.department, extract(epoch FROM min(a.hired_at) - j.created_at) / 86400.0 AS days_to_fill
  FROM recruiting.jobs j
  JOIN recruiting.applications a ON a.job_id = j.job_id AND a.hired_at IS NOT NULL
  WHERE j.status = 'filled'
  GROUP BY j.job_id, j.department, j.created_at
)
SELECT department, count(*) AS filled_n, round(avg(days_to_fill)::numeric, 1) AS avg_days,
       round(min(days_to_fill)::numeric, 1) AS min_days, round(max(days_to_fill)::numeric, 1) AS max_days,
       CASE WHEN count(*) < 30 THEN 'n < 30' ELSE '' END AS sample_warning
FROM filled
GROUP BY department
ORDER BY avg_days;
