export type Job = {
  id: number;
  source: string;
  title: string;
  company_name: string | null;
  job_url: string | null;
  location: string | null;
  description: string | null;
  job_type: string | null;
  is_remote: boolean | null;
  work_mode: string;
  date_posted: string | null;
  visa_status: string;
  visa_score: string;
  apply_priority: string;
  first_seen_at: string;
  last_seen_at: string;
  fit_score: number;
  qualification_status: string;
  matched_skills: string[];
  missing_skills: string[];
  trust_score: number;
  trust_status: string;
  application_status: string | null;
  applied_at: string | null;
  easy_apply: boolean;
  salary_display: string | null;
  min_amount: number | null;
  max_amount: number | null;
  best_ats_score: number | null;
  resume_ready: boolean;
};

export type Stats = {
  total_jobs: number;
  remote_jobs: number;
  companies: number;
};

export type Application = {
  id: number;
  job_id: number;
  status: string;
  applied_at: string | null;
  job: Job;
};

export type CollectPayload = {
  search_term: string;
  location: string | null;
  sites: string[];
  results_wanted: number;
  country_indeed: string;
  is_remote: boolean;
  job_type: string | null;
  hours_old: number | null;
  use_company_targets: boolean;
  visa_friendly_only: boolean;
  skip_expand?: boolean;
};

export type CollectResult = {
  search_run_id: number;
  jobs_seen: number;
  jobs_added: number;
  warnings: string[];
  errors: string[];
};

export type SourceCount = {
  source: string;
  job_count: number;
};

export type SourceHealth = {
  source: string;
  status: string;
  last_run_at: string | null;
  jobs_seen: number;
  stored_jobs: number;
  warnings: string[];
  errors: string[];
};

export type CompanyTarget = {
  rank: number;
  company: string;
  sector: string | null;
  h1b_or_funding: string | null;
  avg_salary: string | null;
  sponsor_status: string | null;
  career_url: string | null;
};

export type SavedSearch = {
  id: number;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ResumeParseResult = {
  filename: string;
  text: string;
};

export type ResumeRebuildResult = {
  provider: string;
  model: string | null;
  rebuilt_resume: string;
  change_summary: string[];
  warnings: string[];
  prompt: string;
};

export type ResumeVersion = {
  id: number;
  job_id: number;
  profile_name: string | null;
  company_name: string | null;
  job_title: string | null;
  provider: string | null;
  model: string | null;
  content_text: string;
  ats_before_score: number | null;
  ats_after_score: number | null;
  warnings: string[];
  created_at: string;
};

export type CoverLetterVersion = {
  id: number;
  job_id: number;
  profile_name: string | null;
  company_name: string | null;
  job_title: string | null;
  provider: string | null;
  model: string | null;
  content_text: string;
  warnings: string[];
  created_at: string;
};

export type JobDocuments = {
  resume_versions: ResumeVersion[];
  cover_letter_versions: CoverLetterVersion[];
};

export type AIGenerationJob = {
  id: number;
  job_id: number;
  profile_name: string | null;
  generation_type: "resume" | "cover_letter" | "both";
  status: "queued" | "running" | "completed" | "failed" | "needs_jd";
  company_name: string | null;
  job_title: string | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  resume_version_id: number | null;
  cover_letter_version_id: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type DocumentGenerationResult = {
  queued: number;
  jobs: AIGenerationJob[];
};

export type ColdEmailResult = {
  provider: string;
  model: string | null;
  subject: string;
  email_body: string;
  linkedin_message: string;
  follow_up_message: string;
  recruiter_name: string | null;
  recruiter_email: string | null;
};

export type ResumeModelChoice = {
  provider: string;
  model: string;
  label: string;
  tier: "Free / Low cost" | "Premium";
};

export type SchedulerStatus = {
  running: boolean;
  interval_hours: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_search_run_id: number | null;
  last_jobs_seen: number | null;
  last_error_count: number | null;
  last_errors: string[];
};
