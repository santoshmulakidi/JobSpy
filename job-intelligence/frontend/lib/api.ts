import type {
  Application,
  AIGenerationJob,
  ColdEmailResult,
  CollectPayload,
  CollectResult,
  CompanyTarget,
  DocumentGenerationResult,
  Job,
  JobDocuments,
  ResumeParseResult,
  ResumeRebuildResult,
  SavedSearch,
  SchedulerStatus,
  SourceHealth,
  SourceCount,
  Stats,
  ResumeModelChoice,
} from "@/types/job";

const API_BASE_URL = process.env.NEXT_PUBLIC_JOB_API_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = typeof window !== "undefined" ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const cacheOptions = typeof window === "undefined" ? { next: { revalidate: 60 } } : {};
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      ...cacheOptions,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

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

export async function getDirectJobs(limit = 500) {
  return request<Job[]>(`/jobs?direct=true&limit=${limit}`);
}

export async function triggerDirectScrape() {
  return request<{ status: string; message: string }>("/direct-jobs/trigger", { method: "POST" });
}

export async function autoQueueTopJobs(n = 10, minFit = 60) {
  return request<{ queued: number; message: string }>(
    `/documents/auto-queue-top?n=${n}&min_fit=${minFit}`,
    { method: "POST" }
  );
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

export async function getCollectionRuns(keyword?: string | null): Promise<{ bucket: string; count: number }[]> {
  const params = new URLSearchParams();
  if (keyword) params.set("keyword", keyword);
  const qs = params.toString();
  return request<{ bucket: string; count: number }[]>(`/jobs/collection-runs${qs ? `?${qs}` : ""}`);
}

export async function getJobsByRun(bucket: string, keyword?: string | null): Promise<Job[]> {
  // bucket format from API: "2026-06-15 18:45" (UTC, space-separated)
  const parts = bucket.split(" ");
  const datePart = parts[0] ?? "";
  const timeParts = (parts[1] ?? "00:00").split(":").map(Number);
  const hh = timeParts[0] ?? 0;
  const mm = timeParts[1] ?? 0;
  const endMm = (mm + 15) % 60;
  const endHh = mm + 15 >= 60 ? hh + 1 : hh;
  const endBucket = `${datePart} ${String(endHh).padStart(2, "0")}:${String(endMm).padStart(2, "0")}`;
  const params = new URLSearchParams({
    first_seen_after: bucket,
    first_seen_before: endBucket,
    limit: "500",
    offset: "0",
  });
  if (keyword) params.set("keyword", keyword);
  return request<Job[]>(`/jobs?${params.toString()}`);
}

export async function collectJobs(payload: CollectPayload) {
  return request<CollectResult>("/collect", {
    method: "POST",
    body: JSON.stringify(payload),
  }, 5 * 60_000); // 5 min — scraping multiple sites takes time
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

export async function getSourceHealth() {
  return request<SourceHealth[]>("/source-health");
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
  }, 180_000); // 3 min — AI + fallback chain can be slow
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
    { provider: "gemini", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash Free", tier: "Free / Low cost" },
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

export async function getArchivedJobs(keyword?: string, limit = 200) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (keyword) params.set("keyword", keyword);
  return request<Job[]>(`/jobs/archived?${params}`);
}

export async function updateApplicationStage(applicationId: number, status: string, notes?: string) {
  return request<{ ok: boolean }>(`/applications/${applicationId}/stage`, {
    method: "PATCH",
    body: JSON.stringify({ status, notes: notes ?? null }),
  });
}

export async function saveJobNotes(jobId: number, notes: string) {
  return request<{ ok: boolean }>(`/jobs/${jobId}/notes`, {
    method: "POST",
    body: JSON.stringify({ notes }),
  });
}

export async function generateCoverLetter(payload: {
  base_resume: string;
  job_description: string;
  job_title?: string | null;
  company_name?: string | null;
  provider?: string | null;
  model?: string | null;
}) {
  return request<{ provider: string; model: string | null; cover_letter: string }>("/resume/cover-letter", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function queueDocumentGeneration(payload: {
  job_ids: number[];
  generation_type: "resume" | "cover_letter" | "both";
  base_resume: string;
  profile_name?: string | null;
  provider?: string | null;
  model?: string | null;
  force_regenerate?: boolean;
}) {
  return request<DocumentGenerationResult>("/documents/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getDocumentGenerationJobs(limit = 100) {
  return request<AIGenerationJob[]>(`/documents/generation-jobs?limit=${limit}`);
}

export async function requeueGenerationJob(id: number) {
  return request<AIGenerationJob>(`/documents/generation-jobs/${id}/requeue`, { method: "POST" });
}

export async function deleteGenerationJob(id: number) {
  const controller = new AbortController();
  const response = await fetch(`${API_BASE_URL}/documents/generation-jobs/${id}`, {
    method: "DELETE",
    signal: controller.signal,
  });
  if (!response.ok && response.status !== 204) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Delete failed: ${response.status}${detail ? ` - ${detail}` : ""}`);
  }
}

export async function getJobDocuments(jobId: number) {
  return request<JobDocuments>(`/jobs/${jobId}/documents`);
}

export async function generateColdEmail(payload: {
  job_title: string;
  company_name?: string | null;
  job_description: string;
  candidate_summary: string;
  recruiter_name?: string | null;
  recruiter_email?: string | null;
  contact_role?: string | null;
  tone?: string | null;
  provider?: string | null;
  model?: string | null;
}) {
  return request<ColdEmailResult>("/resume/cold-email", {
    method: "POST",
    body: JSON.stringify(payload),
  }, 120_000);
}

export async function exportCoverLetterDocx(payload: {
  base_resume: string;
  job_description: string;
  cover_letter_text: string;
  job_title?: string | null;
  company_name?: string | null;
}): Promise<{ blob: Blob; savedTo: string | null }> {
  const response = await fetch(`${API_BASE_URL}/resume/cover-letter-docx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Cover letter export failed: ${response.status}${detail ? ` - ${detail}` : ""}`);
  }
  return { blob: await response.blob(), savedTo: response.headers.get("X-Saved-To") };
}
