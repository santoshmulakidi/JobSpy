import type {
  Application,
  CollectPayload,
  CollectResult,
  CompanyTarget,
  Job,
  ResumeParseResult,
  SavedSearch,
  SchedulerStatus,
  SourceCount,
  Stats,
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

export async function getSchedulerStatus() {
  return request<SchedulerStatus>("/scheduler/status");
}
