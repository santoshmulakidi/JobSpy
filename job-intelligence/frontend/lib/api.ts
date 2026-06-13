import type {
  Application,
  CollectPayload,
  CollectResult,
  CompanyTarget,
  Job,
  ResumeParseResult,
  ResumeRebuildResult,
  SavedSearch,
  SchedulerStatus,
  SourceCount,
  Stats,
  ResumeModelChoice,
} from "@/types/job";

const API_BASE_URL = process.env.NEXT_PUBLIC_JOB_API_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const cacheOptions = typeof window === "undefined" ? { next: { revalidate: 60 } } : {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...cacheOptions,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`API request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`);
  }

  return response.json() as Promise<T>;
}

export async function getStats() {
  return request<Stats>("/stats");
}

export async function getJobs(limit = 24, offset = 0) {
  return request<Job[]>(`/jobs?limit=${limit}&offset=${offset}`);
}

export async function getJob(jobId: number) {
  return request<Job>(`/jobs/${jobId}`);
}

export async function getApplications() {
  return request<Application[]>("/applications");
}

export async function searchJobs(payload: Record<string, unknown>) {
  return request<Job[]>("/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function collectJobs(payload: CollectPayload) {
  return request<CollectResult>("/collect", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function markJobApplied(jobId: number, payload: Record<string, unknown> = { status: "Applied" }) {
  return request<Application>(`/jobs/${jobId}/apply`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getSourceCounts() {
  return request<SourceCount[]>("/source-counts");
}

export async function getCompanyTargets(limit = 500) {
  return request<CompanyTarget[]>(`/company-targets?limit=${limit}`);
}

export async function getSavedSearches() {
  return request<SavedSearch[]>("/saved-searches");
}

export async function deleteSavedSearch(id: number) {
  return request<{ status: string }>(`/saved-searches/${id}`, { method: "DELETE" });
}

export async function parseResume(filename: string, contentBase64: string) {
  return request<ResumeParseResult>("/resume/parse", {
    method: "POST",
    body: JSON.stringify({ filename, content_base64: contentBase64 }),
  });
}

export async function rebuildResume(payload: {
  base_resume: string;
  job_description: string;
  profile_name?: string | null;
  target_title?: string | null;
  provider?: string | null;
  model?: string | null;
  refine_instruction?: string | null;
}) {
  return request<ResumeRebuildResult>("/resume/rebuild", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function exportResumeDocx(resumeText: string, filename = "resume"): Promise<{ blob: Blob; savedTo: string | null }> {
  const response = await fetch(`${API_BASE_URL}/resume/export-docx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resume_text: resumeText, filename }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Word export failed: ${response.status}${detail ? ` - ${detail}` : ""}`);
  }
  return {
    blob: await response.blob(),
    savedTo: response.headers.get("X-Saved-To"),
  };
}

export function resumeModelChoices(): ResumeModelChoice[] {
  return [
    { provider: "gemini", model: "gemini-2.5-flash", label: "Recommended: Gemini 2.5 Flash (500/day free)", tier: "Free / Low cost" },
    { provider: "gemini", model: "gemini-2.0-flash", label: "Free: Gemini 2.0 Flash", tier: "Free / Low cost" },
    { provider: "groq", model: "llama-4-maverick-17b-128e-instruct", label: "Free/fast: Groq Llama 4 Maverick", tier: "Free / Low cost" },
    { provider: "groq", model: "llama-3.3-70b-versatile", label: "Free/fast: Groq Llama 3.3 70B", tier: "Free / Low cost" },
    { provider: "openrouter", model: "qwen/qwen3-235b-a22b:free", label: "Free: OpenRouter Qwen 3 235B", tier: "Free / Low cost" },
    { provider: "openrouter", model: "meta-llama/llama-4-maverick:free", label: "Free: OpenRouter Llama 4 Maverick", tier: "Free / Low cost" },
    { provider: "openrouter", model: "google/gemma-3-27b-it:free", label: "Free: OpenRouter Gemma 3 27B", tier: "Free / Low cost" },
    { provider: "nvidia", model: "meta/llama-3.1-8b-instruct", label: "Free: NVIDIA Llama 3.1 8B", tier: "Free / Low cost" },
    { provider: "openrouter", model: "anthropic/claude-sonnet-4-5", label: "Premium: Claude Sonnet 4.5", tier: "Premium" },
    { provider: "openrouter", model: "anthropic/claude-opus-4-5", label: "Premium: Claude Opus 4.5", tier: "Premium" },
    { provider: "openrouter", model: "openai/gpt-4o", label: "Premium: GPT-4o", tier: "Premium" },
  ];
}

export async function getSchedulerStatus() {
  return request<SchedulerStatus>("/scheduler/status");
}
