# Recruiting analytics: synthetic data model

Use fabricated records only. Never include real candidate names, emails, phone numbers, or other personal information.

## Tables and grain

- `jobs`: one row per vacancy (`job_id`); includes `created_at`, `closed_at`, `status`, `department`, `location`, `priority`, `recruiter_id`.
- `candidates`: one row per synthetic candidate (`candidate_id`); avoid unnecessary personal attributes.
- `applications`: one row per candidate's application to one job (`application_id`); includes `candidate_id`, `job_id`, `source`, `applied_at`, `current_stage`, `stage_updated_at`, `hired_at`, `rejected_at`.
- `recruiters`: one row per recruiter (`recruiter_id`).

## KPI definitions to document

- Open vacancies: count jobs open as of the reporting date, not all rows whose status ever included "open".
- Time to fill: define whether measured from vacancy creation to accepted offer or job closure; apply one consistent definition.
- Application-to-interview conversion: distinct applications that reached interview / distinct eligible applications in the cohort.
- Interview-to-hire conversion: distinct applications that reached hire / distinct applications that reached interview.
- Vacancy aging: reporting date minus vacancy creation date for currently open vacancies.
- Source effectiveness: hires by source alongside volume and sample size. Avoid interpreting small samples as definitive.

## Suggested quality checks

- Unique `job_id`, `candidate_id`, `application_id`, and `recruiter_id`.
- Every application references an existing job and candidate.
- Stage dates should not precede application date.
- Hired applications should have a hire date; non-hired applications should not be silently assigned one.
- Closed vacancies should have a closing date if required by your business definition.
