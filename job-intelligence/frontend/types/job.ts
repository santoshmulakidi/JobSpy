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
