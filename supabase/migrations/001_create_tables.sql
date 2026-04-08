-- ============================================================================
--  ADVANCE INTERVIEW LAB — Full Database Schema
--  Run this in your Supabase SQL Editor to set up all tables.
-- ============================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── 1. Users ─────────────────────────────────────────────────────────────────

create table users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  full_name   text,
  created_at  timestamptz not null default now()
);

comment on table users is 'Core user identity table.';

-- Seed a placeholder user for MVP (no auth yet)
insert into users (id, email, full_name) values (
  '00000000-0000-0000-0000-000000000000',
  'mvp@placeholder.local',
  'MVP User'
);

-- ── 2. Candidate Profiles ────────────────────────────────────────────────────

create table candidate_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  full_name       text,
  headline        text,
  summary         text,
  parsed_cv_json  jsonb,       -- structured CV data extracted by AI
  cv_file_path    text,        -- Supabase Storage path if file uploaded
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_candidate_profiles_user on candidate_profiles(user_id);

-- ── 3. Companies ─────────────────────────────────────────────────────────────

create table companies (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  canonical_domain  text,      -- e.g. "google.com"
  website_url       text,
  linkedin_url      text,
  description       text,
  industry          text,
  company_size      text,
  headquarters      text,
  research_status   text default 'pending',  -- pending | researching | done | failed
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_companies_name on companies(name);
create index idx_companies_domain on companies(canonical_domain);

-- ── 4. Company Research Reports ──────────────────────────────────────────────

create table company_research_reports (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  source_inputs_json    jsonb,    -- what URLs/data were used as input
  summary_json          jsonb,    -- company overview summary
  recent_activity_json  jsonb,    -- recent news, events, funding
  products_services_json jsonb,   -- products and services breakdown
  raw_sources_json      jsonb,    -- raw scraped/fetched source data
  created_at            timestamptz not null default now()
);

create index idx_company_research_company on company_research_reports(company_id);

-- ── 5. Job Targets ───────────────────────────────────────────────────────────

create table job_targets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  company_id      uuid references companies(id) on delete set null,
  title           text not null,
  location        text,
  seniority       text,
  jd_text         text,          -- raw job description text
  parsed_jd_json  jsonb,         -- AI-parsed competencies, requirements, etc.
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_job_targets_user on job_targets(user_id);
create index idx_job_targets_company on job_targets(company_id);

-- ── 6. Rubric Templates ─────────────────────────────────────────────────────

create table rubric_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  rubric_type   text not null default 'IRS',  -- "IRS" | "IRS_PLUS"
  schema_json   jsonb not null,               -- rubric dimension definitions
  created_at    timestamptz not null default now()
);

-- Seed the default IRS rubric template
insert into rubric_templates (name, rubric_type, schema_json) values (
  'IRS Standard',
  'IRS',
  '{
    "dimensions": [
      {"key": "integrity",  "label": "Integrity",  "weight": 0.30, "description": "Authenticity, honesty, internal consistency"},
      {"key": "relevance",  "label": "Relevance",  "weight": 0.30, "description": "Addresses question, competency, and target role"},
      {"key": "substance",  "label": "Substance",  "weight": 0.40, "description": "Depth, specifics, examples, metrics, STAR method"}
    ],
    "scale_min": 0,
    "scale_max": 10
  }'::jsonb
);

-- ── 7. Job Rubrics ───────────────────────────────────────────────────────────

create table job_rubrics (
  id                  uuid primary key default gen_random_uuid(),
  job_target_id       uuid not null references job_targets(id) on delete cascade,
  rubric_template_id  uuid not null references rubric_templates(id) on delete restrict,
  competencies_json   jsonb,      -- competencies derived from JD
  weights_json        jsonb,      -- per-competency weights
  generated_from_json jsonb,      -- references to JD + CV + research used
  created_at          timestamptz not null default now()
);

create index idx_job_rubrics_target on job_rubrics(job_target_id);

-- ── 8. Personas ──────────────────────────────────────────────────────────────

create table personas (
  id          text primary key,
  name        text not null,
  title       text,
  description text,
  config_json jsonb,       -- tone, strictness, followUpDepth, etc.
  is_active   boolean not null default true
);

-- Seed the 5 default personas
insert into personas (id, name, title, description, config_json) values
  ('skeptic',    'Jordan Voss',       'Senior Director of Operations', 'Challenges every claim. Expects hard evidence and numbers.',                  '{"tone":"skeptical","strictness":9,"followUpDepth":3,"style":"Tough · Data-Driven · Persistent"}'),
  ('mentor',     'Dr. Priya Chandran','VP of People & Culture',        'Warm but probing. Wants to understand your growth mindset and journey.',      '{"tone":"warm","strictness":5,"followUpDepth":2,"style":"Warm · Thoughtful · Growth-Focused"}'),
  ('executive',  'Marcus Chen',       'Chief Executive Officer',       'Time-pressured. Wants strategic thinking and bottom-line impact fast.',       '{"tone":"direct","strictness":8,"followUpDepth":1,"style":"Direct · Strategic · Time-Conscious"}'),
  ('technical',  'Aisha Okafor',      'Principal Engineer',            'Deep technical dives. Tests problem-solving process and first principles.',   '{"tone":"analytical","strictness":7,"followUpDepth":3,"style":"Analytical · Precise · Systems-Thinker"}'),
  ('culture',    'Sam Rivera',        'Head of Talent Acquisition',    'Assesses team fit, values alignment, and collaborative potential.',            '{"tone":"conversational","strictness":4,"followUpDepth":2,"style":"Conversational · Values-Driven · Collaborative"}');

-- ── 9. Interview Packs ───────────────────────────────────────────────────────

create table interview_packs (
  id                          uuid primary key default gen_random_uuid(),
  job_target_id               uuid not null references job_targets(id) on delete cascade,
  candidate_profile_id        uuid not null references candidate_profiles(id) on delete cascade,
  persona_id                  text not null references personas(id) on delete restrict,
  company_research_report_id  uuid references company_research_reports(id) on delete set null,
  plan_json                   jsonb,       -- interview plan (competencies, order, timing)
  question_set_json           jsonb,       -- pre-generated questions
  created_at                  timestamptz not null default now()
);

create index idx_interview_packs_target on interview_packs(job_target_id);

-- ── 10. Interview Sessions ───────────────────────────────────────────────────

create table interview_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references users(id) on delete set null,
  candidate_profile_id  uuid references candidate_profiles(id) on delete set null,
  job_target_id         uuid references job_targets(id) on delete set null,
  interview_pack_id     uuid references interview_packs(id) on delete set null,
  persona_id            text not null references personas(id) on delete restrict,
  mode                  text not null default 'live_ai',  -- "live_ai" | "uploaded_recording"
  status                text not null default 'active',   -- active | evaluating | complete
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  final_score_json      jsonb,        -- aggregated IRS scores
  final_report_json     jsonb,        -- full feedback report
  context_json          jsonb,        -- snapshot of CV text, JD, company name used
  created_at            timestamptz not null default now()
);

create index idx_sessions_user on interview_sessions(user_id);
create index idx_sessions_status on interview_sessions(status);

-- ── 11. Session Media (for uploaded recordings — MVP stub) ───────────────────

create table session_media (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references interview_sessions(id) on delete cascade,
  media_type            text not null,      -- "audio" | "video"
  storage_path          text not null,
  duration_seconds      numeric,
  transcription_status  text default 'pending',
  diarization_status    text default 'pending',
  created_at            timestamptz not null default now()
);

create index idx_session_media_session on session_media(session_id);

-- ── 12. Transcript Turns (for uploaded recordings — MVP stub) ────────────────

create table transcript_turns (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references interview_sessions(id) on delete cascade,
  speaker             text not null,    -- "interviewer" | "candidate" | "unknown"
  turn_index          int not null,
  start_ms            int,
  end_ms              int,
  content             text not null,
  derived_question_id uuid,
  created_at          timestamptz not null default now()
);

create index idx_transcript_turns_session on transcript_turns(session_id);

-- ── 13. Interview Questions ──────────────────────────────────────────────────

create table interview_questions (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references interview_sessions(id) on delete cascade,
  competency_id   text,
  question_text   text not null,
  question_type   text,           -- "behavioral" | "technical" | "case" | "culture"
  source          text not null default 'generated',  -- "generated" | "uploaded_transcript" | "question_bank"
  asked_at        timestamptz not null default now()
);

create index idx_questions_session on interview_questions(session_id);

-- ── 14. Answer Assessments ───────────────────────────────────────────────────

create table answer_assessments (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references interview_sessions(id) on delete cascade,
  question_id           uuid not null references interview_questions(id) on delete cascade,
  transcript_turn_id    uuid references transcript_turns(id) on delete set null,
  candidate_answer      text,         -- the actual answer text
  integrity_score       numeric not null,
  relevance_score       numeric not null,
  substance_score       numeric not null,
  overall_score         numeric not null,
  rationale_json        jsonb,        -- per-dimension rationale
  evidence_json         jsonb,        -- evidence spans from the answer
  missing_signals_json  jsonb,        -- what was missing
  confidence            numeric default 1.0,
  created_at            timestamptz not null default now()
);

create index idx_assessments_session on answer_assessments(session_id);
create index idx_assessments_question on answer_assessments(question_id);

-- ── 15. Answer Coaching ──────────────────────────────────────────────────────

create table answer_coaching (
  id                  uuid primary key default gen_random_uuid(),
  assessment_id       uuid not null references answer_assessments(id) on delete cascade,
  original_answer     text,
  critique_json       jsonb,        -- structured critique of the answer
  improved_answer     text,         -- AI-improved version
  best_sample_answer  text,         -- model/best answer for this question
  created_at          timestamptz not null default now()
);

create index idx_coaching_assessment on answer_coaching(assessment_id);

-- ── 16. Question Bank ────────────────────────────────────────────────────────

create table question_bank_entries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id) on delete set null,
  company_name  text,
  country       text default 'UK',
  role_family   text,           -- e.g. "Engineering", "Marketing", "Finance"
  job_title     text,
  seniority     text,           -- "Junior" | "Mid" | "Senior" | "Lead" | "Director"
  question_text text not null,
  question_type text,           -- "behavioral" | "technical" | "case" | "culture"
  source_type   text not null default 'curated',  -- "public" | "community" | "curated"
  source_url    text,
  confidence    numeric default 0.8,
  tags          text[],
  created_at    timestamptz not null default now()
);

create index idx_question_bank_company on question_bank_entries(company_id);
create index idx_question_bank_company_name on question_bank_entries(company_name);
create index idx_question_bank_role on question_bank_entries(role_family);
create index idx_question_bank_type on question_bank_entries(question_type);

-- ── Row-Level Security (basic policies) ──────────────────────────────────────
-- Enable RLS on user-owned tables. For MVP with server-side API routes using
-- the service_role key, these policies are not strictly enforced, but they
-- prepare the schema for future client-side auth.

alter table users enable row level security;
alter table candidate_profiles enable row level security;
alter table job_targets enable row level security;
alter table interview_sessions enable row level security;
alter table answer_assessments enable row level security;
alter table answer_coaching enable row level security;

-- Allow authenticated users to read/write their own data
create policy "Users can read own profile"
  on users for select using (auth.uid() = id);

create policy "Users can read own candidate profiles"
  on candidate_profiles for select using (auth.uid() = user_id);
create policy "Users can insert own candidate profiles"
  on candidate_profiles for insert with check (auth.uid() = user_id);
create policy "Users can update own candidate profiles"
  on candidate_profiles for update using (auth.uid() = user_id);

create policy "Users can read own job targets"
  on job_targets for select using (auth.uid() = user_id);
create policy "Users can insert own job targets"
  on job_targets for insert with check (auth.uid() = user_id);

create policy "Users can read own sessions"
  on interview_sessions for select using (auth.uid() = user_id);
create policy "Users can insert own sessions"
  on interview_sessions for insert with check (auth.uid() = user_id);
create policy "Users can update own sessions"
  on interview_sessions for update using (auth.uid() = user_id);

-- Public read access for shared tables
create policy "Anyone can read companies"
  on companies for select using (true);
create policy "Anyone can read personas"
  on personas for select using (true);
create policy "Anyone can read rubric templates"
  on rubric_templates for select using (true);
create policy "Anyone can read question bank"
  on question_bank_entries for select using (true);

-- ============================================================================
--  Done. All tables, indexes, seed data, and RLS policies are ready.
-- ============================================================================

-- ── 17. CV Versions ─────────────────────────────────────────────────────────
create table if not exists cv_versions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  name             text not null,
  source_file_path text,
  raw_text         text not null,
  detected_field   text,
  is_active        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_cv_versions_user
  on cv_versions(user_id);

create unique index if not exists idx_cv_versions_one_active_per_user
  on cv_versions(user_id) where is_active = true;

-- ── 18. CV Bullets ──────────────────────────────────────────────────────────
create table if not exists cv_bullets (
  id            uuid primary key default gen_random_uuid(),
  cv_version_id uuid not null references cv_versions(id) on delete cascade,
  section_path  text,
  bullet_text   text not null,
  ordinal       int not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_cv_bullets_version
  on cv_bullets(cv_version_id);

-- ── 19. Bullet Gaps ─────────────────────────────────────────────────────────
create table if not exists bullet_gaps (
  id         uuid primary key default gen_random_uuid(),
  bullet_id  uuid not null references cv_bullets(id) on delete cascade,
  question   text not null,
  rationale  text,
  ordinal    int not null,
  status     text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bullet_gaps_bullet
  on bullet_gaps(bullet_id);

create unique index if not exists idx_bullet_gaps_unique_ordinal
  on bullet_gaps(bullet_id, ordinal);

-- ── 20. Bullet Artifacts ────────────────────────────────────────────────────
create table if not exists bullet_artifacts (
  id               uuid primary key default gen_random_uuid(),
  gap_id           uuid not null references bullet_gaps(id) on delete cascade,
  source_type      text not null,
  content_text     text,
  source_url       text,
  source_file_path text,
  summary_json     jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists idx_bullet_artifacts_gap
  on bullet_artifacts(gap_id);

-- ── 21. interview_sessions.cv_version_id ────────────────────────────────────
alter table interview_sessions
  add column if not exists cv_version_id uuid references cv_versions(id) on delete set null;

create index if not exists idx_sessions_cv_version
  on interview_sessions(cv_version_id);
