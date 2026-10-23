-- Step 5. Data validation for the recruiting schema (PostgreSQL / Supabase).
-- Run with: python scripts/run_sql.py sql/recruiting/05_validation.sql
-- Read-only. The second query is the pass/fail list: every check must return 0.
-- Several checks repeat what a CHECK or FOREIGN KEY already enforces; they stay here
-- so the file still proves the data is clean if a constraint is ever relaxed.

-- @@ 5a. Row counts
SELECT 'recruiters' AS table_name, count(*) AS row_count FROM recruiting.recruiters
UNION ALL SELECT 'jobs', count(*) FROM recruiting.jobs
UNION ALL SELECT 'candidates', count(*) FROM recruiting.candidates
UNION ALL SELECT 'applications', count(*) FROM recruiting.applications
UNION ALL SELECT 'application_events', count(*) FROM recruiting.application_events
UNION ALL SELECT 'requisition_queue', count(*) FROM recruiting.requisition_queue
UNION ALL SELECT 'simulation_runs', count(*) FROM recruiting.simulation_runs
UNION ALL SELECT 'automation_runs', count(*) FROM recruiting.automation_runs;

-- @@ 5b. Checks (failing_rows must be 0)
WITH hires AS (
  SELECT job_id, count(*) AS n, min(hired_at) AS first_hire
  FROM recruiting.applications WHERE hired_at IS NOT NULL GROUP BY job_id
),
last_event AS (
  SELECT DISTINCT ON (application_id) application_id, to_stage, event_at
  FROM recruiting.application_events
  ORDER BY application_id, event_at DESC, event_id DESC
),
ordered_events AS (
  SELECT application_id, event_at,
         lag(event_at) OVER (PARTITION BY application_id ORDER BY event_id) AS prev_at
  FROM recruiting.application_events
),
by_source AS (
  SELECT source, count(*) AS apps, count(interviewed_at) AS interviews, count(hired_at) AS hires
  FROM recruiting.applications GROUP BY source
),
sim_gaps AS (
  SELECT d::date AS day
  FROM (SELECT min(sim_date) AS lo, max(sim_date) AS hi FROM recruiting.simulation_runs) b,
       generate_series(b.lo, b.hi, interval '1 day') d
  WHERE NOT EXISTS (SELECT 1 FROM recruiting.simulation_runs r
                    WHERE r.sim_date = d::date AND r.status IN ('success', 'seed'))
)
SELECT check_name, failing_rows FROM (
  -- orphans
  SELECT 1 AS ord, 'orphan: application -> job' AS check_name,
         (SELECT count(*) FROM recruiting.applications a
          WHERE NOT EXISTS (SELECT 1 FROM recruiting.jobs j WHERE j.job_id = a.job_id)) AS failing_rows
  UNION ALL SELECT 2, 'orphan: application -> candidate',
         (SELECT count(*) FROM recruiting.applications a
          WHERE NOT EXISTS (SELECT 1 FROM recruiting.candidates c WHERE c.candidate_id = a.candidate_id))
  UNION ALL SELECT 3, 'orphan: job -> recruiter',
         (SELECT count(*) FROM recruiting.jobs j
          WHERE NOT EXISTS (SELECT 1 FROM recruiting.recruiters r WHERE r.recruiter_id = j.recruiter_id))
  UNION ALL SELECT 4, 'orphan: event -> application',
         (SELECT count(*) FROM recruiting.application_events e
          WHERE NOT EXISTS (SELECT 1 FROM recruiting.applications a WHERE a.application_id = e.application_id))
  UNION ALL SELECT 5, 'orphan: requisition -> job',
         (SELECT count(*) FROM recruiting.requisition_queue q
          WHERE q.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM recruiting.jobs j WHERE j.job_id = q.job_id))
  UNION ALL SELECT 6, 'candidate with no application',
         (SELECT count(*) FROM recruiting.candidates c
          WHERE NOT EXISTS (SELECT 1 FROM recruiting.applications a WHERE a.candidate_id = c.candidate_id))
  UNION ALL SELECT 7, 'job with no published requisition',
         (SELECT count(*) FROM recruiting.jobs j
          WHERE NOT EXISTS (SELECT 1 FROM recruiting.requisition_queue q
                            WHERE q.job_id = j.job_id AND q.status = 'published'))
  -- dates out of order
  UNION ALL SELECT 10, 'stage dates out of order',
         (SELECT count(*) FROM recruiting.applications
          WHERE screened_at < applied_at OR interviewed_at < screened_at OR offer_at < interviewed_at
             OR hired_at < offer_at OR rejected_at < applied_at)
  UNION ALL SELECT 11, 'application before job created',
         (SELECT count(*) FROM recruiting.applications a JOIN recruiting.jobs j USING (job_id)
          WHERE a.applied_at < j.created_at)
  UNION ALL SELECT 12, 'application after job closed',
         (SELECT count(*) FROM recruiting.applications a JOIN recruiting.jobs j USING (job_id)
          WHERE a.applied_at > j.closed_at)
  UNION ALL SELECT 13, 'candidate created after first application',
         (SELECT count(*) FROM recruiting.candidates c
          WHERE c.created_at > (SELECT min(applied_at) FROM recruiting.applications a
                                WHERE a.candidate_id = c.candidate_id))
  UNION ALL SELECT 14, 'event before application date',
         (SELECT count(*) FROM recruiting.application_events e JOIN recruiting.applications a USING (application_id)
          WHERE e.event_at < a.applied_at)
  UNION ALL SELECT 15, 'events out of time order',
         (SELECT count(*) FROM ordered_events WHERE event_at < prev_at)
  UNION ALL SELECT 16, 'job last_updated_at older than its applications',
         (SELECT count(*) FROM recruiting.jobs j
          WHERE j.last_updated_at < (SELECT max(a.last_updated_at) FROM recruiting.applications a
                                     WHERE a.job_id = j.job_id))
  UNION ALL SELECT 17, 'filled job closed before its hire',
         (SELECT count(*) FROM recruiting.jobs j JOIN hires h USING (job_id) WHERE j.closed_at < h.first_hire)
  UNION ALL SELECT 18, 'timestamp in the future',
         (SELECT count(*) FROM recruiting.applications WHERE last_updated_at > now())
       + (SELECT count(*) FROM recruiting.jobs WHERE last_updated_at > now())
  -- hire consistency
  UNION ALL SELECT 20, 'filled job without a hire',
         (SELECT count(*) FROM recruiting.jobs j
          WHERE j.status = 'filled' AND NOT EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.job_id))
  UNION ALL SELECT 21, 'more than one hire per job',
         (SELECT count(*) FROM hires WHERE n > 1)
  UNION ALL SELECT 22, 'hire on a job that is not filled',
         (SELECT count(*) FROM hires h JOIN recruiting.jobs j USING (job_id) WHERE j.status <> 'filled')
  UNION ALL SELECT 23, 'active application on a closed job',
         (SELECT count(*) FROM recruiting.applications a JOIN recruiting.jobs j USING (job_id)
          WHERE j.status IN ('filled', 'cancelled')
            AND a.current_stage IN ('applied', 'screening', 'interview', 'offer'))
  UNION ALL SELECT 24, 'current_stage differs from last event',
         (SELECT count(*) FROM recruiting.applications a JOIN last_event e USING (application_id)
          WHERE a.current_stage <> e.to_stage OR a.last_updated_at <> e.event_at)
  UNION ALL SELECT 25, 'application without events',
         (SELECT count(*) FROM recruiting.applications a
          WHERE NOT EXISTS (SELECT 1 FROM recruiting.application_events e WHERE e.application_id = a.application_id))
  -- numerators never above denominators
  UNION ALL SELECT 30, 'source: interviews > applications or hires > interviews',
         (SELECT count(*) FROM by_source WHERE interviews > apps OR hires > interviews)
  UNION ALL SELECT 31, 'automation_runs: flagged > checked',
         (SELECT count(*) FROM recruiting.automation_runs WHERE jobs_flagged > jobs_checked)
  -- simulator log
  UNION ALL SELECT 40, 'missing day in simulation_runs',
         (SELECT count(*) FROM sim_gaps)
  UNION ALL SELECT 41, 'requisition: published without job or job without published',
         (SELECT count(*) FROM recruiting.requisition_queue WHERE (status = 'published') <> (job_id IS NOT NULL))
) c
ORDER BY ord;

-- @@ 5c. Simulator log (latest 10 days)
SELECT sim_date, status, jobs_published, jobs_closed, jobs_on_hold, applications_created,
       stage_changes, hires, rejections, withdrawals, left(error_message, 60) AS error_message
FROM recruiting.simulation_runs
ORDER BY sim_date DESC
LIMIT 10;
