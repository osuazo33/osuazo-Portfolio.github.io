-- Step 4. Tables for the seed and the daily simulator. Migration only: every
-- statement is CREATE ... IF NOT EXISTS, so running it twice changes nothing and
-- it never drops or alters the tables from 01_create_tables.sql.
--
-- requisition_queue   one row per approved requisition waiting to become a job.
--                     queued -> published (job_id set) | cancelled.
-- application_events  one row per stage transition of an application (audit trail).
--                     from_stage is NULL for the first event ('applied').
--                     sim_date is NULL for events written by the seed and holds the
--                     simulated day for events written by the simulator.
-- simulation_runs     one row per simulated day. UNIQUE(sim_date) makes the simulator
--                     idempotent. status = 'seed' marks the last day the seed covered,
--                     so the simulator knows where to start.

CREATE TABLE IF NOT EXISTS recruiting.requisition_queue (
  requisition_id      text PRIMARY KEY,
  title               text NOT NULL,
  department          text NOT NULL,
  recruiter_id        text NOT NULL REFERENCES recruiting.recruiters (recruiter_id),
  requested_at        timestamptz NOT NULL,
  scheduled_open_date date NOT NULL,
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'published', 'cancelled')),
  job_id              text REFERENCES recruiting.jobs (job_id),
  CONSTRAINT requisition_published_has_job
    CHECK ((status = 'published') = (job_id IS NOT NULL)),
  CONSTRAINT requisition_open_after_request
    CHECK (scheduled_open_date >= requested_at::date)
);

CREATE INDEX IF NOT EXISTS idx_requisition_status_date
  ON recruiting.requisition_queue (status, scheduled_open_date);

CREATE TABLE IF NOT EXISTS recruiting.application_events (
  event_id       bigserial PRIMARY KEY,
  application_id text NOT NULL REFERENCES recruiting.applications (application_id),
  from_stage     text CHECK (from_stage IN ('applied', 'screening', 'interview', 'offer')),
  to_stage       text NOT NULL
                 CHECK (to_stage IN ('applied', 'screening', 'interview', 'offer',
                                     'hired', 'rejected', 'withdrawn')),
  event_at       timestamptz NOT NULL,
  sim_date       date,
  CONSTRAINT event_first_is_applied
    CHECK ((from_stage IS NULL) = (to_stage = 'applied'))
);

CREATE INDEX IF NOT EXISTS idx_events_application ON recruiting.application_events (application_id);
CREATE INDEX IF NOT EXISTS idx_events_event_at    ON recruiting.application_events (event_at);

CREATE TABLE IF NOT EXISTS recruiting.simulation_runs (
  run_id               bigserial PRIMARY KEY,
  run_at               timestamptz NOT NULL DEFAULT now(),
  sim_date             date NOT NULL UNIQUE,
  jobs_published       integer NOT NULL DEFAULT 0 CHECK (jobs_published >= 0),
  jobs_closed          integer NOT NULL DEFAULT 0 CHECK (jobs_closed >= 0),
  jobs_on_hold         integer NOT NULL DEFAULT 0 CHECK (jobs_on_hold >= 0),
  applications_created integer NOT NULL DEFAULT 0 CHECK (applications_created >= 0),
  stage_changes        integer NOT NULL DEFAULT 0 CHECK (stage_changes >= 0),
  hires                integer NOT NULL DEFAULT 0 CHECK (hires >= 0),
  rejections           integer NOT NULL DEFAULT 0 CHECK (rejections >= 0),
  withdrawals          integer NOT NULL DEFAULT 0 CHECK (withdrawals >= 0),
  status               text NOT NULL CHECK (status IN ('success', 'error', 'seed')),
  error_message        text
);
