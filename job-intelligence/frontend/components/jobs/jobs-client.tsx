"use client";

import { ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, Copy, FileText, Loader2, Mail, RotateCcw, Search, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { JobTable, type SortKey, type SortDir } from "@/components/dashboard/job-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { deleteGenerationJob, requeueGenerationJob, exportResumeDocx, generateColdEmail, getArchivedJobs, getCollectionRuns, getDirectJobs, getDocumentGenerationJobs, getJobDocuments, getJobsByRun, markJobApplied, queueDocumentGeneration, resumeModelChoices, saveJobNotes, searchJobs, triggerDirectScrape } from "@/lib/api";
import { compactLocation, defaultProfiles, expandSearchTerm, loadProfiles, type JobProfile } from "@/lib/job-profiles";
import { formatDate } from "@/lib/utils";
import type { AIGenerationJob, ColdEmailResult, Job, JobDocuments } from "@/types/job";

const PAGE_SIZE = 30;
const CANDIDATE_LIMIT = 500;

type SortPreset = "best" | "fit_remote" | "fit_latest_remote" | "latest" | "fit" | "salary" | "resume_ready" | "direct_first";

const _DIRECT_SOURCES = new Set(["greenhouse", "lever", "ashby"]);

const SORT_PRESETS: { value: SortPreset; label: string }[] = [
  { value: "best",              label: "Fit + Latest collection" },
  { value: "fit_remote",        label: "Fit + Remote first" },
  { value: "fit_latest_remote", label: "Fit + Latest + Remote" },
  { value: "fit",               label: "Fit score only" },
  { value: "latest",            label: "Most recently collected" },
  { value: "salary",            label: "Salary (high to low)" },
  { value: "resume_ready",     label: "Resume Ready first" },
  { value: "direct_first",    label: "Direct company jobs first" },
];

function applyPresetSort(jobs: Job[], preset: SortPreset): Job[] {
  return [...jobs].sort((a, b) => {
    const fitDelta = (b.fit_score ?? 0) - (a.fit_score ?? 0);
    const dateDelta = Date.parse(b.first_seen_at ?? "") - Date.parse(a.first_seen_at ?? "");
    const remoteA = a.is_remote || a.work_mode === "Remote" ? 1 : 0;
    const remoteB = b.is_remote || b.work_mode === "Remote" ? 1 : 0;
    const remoteDelta = remoteB - remoteA;
    const salaryA = Math.max(a.min_amount ?? 0, a.max_amount ?? 0);
    const salaryB = Math.max(b.min_amount ?? 0, b.max_amount ?? 0);
    switch (preset) {
      case "best":              return fitDelta !== 0 ? fitDelta : dateDelta;
      case "fit_remote":        return fitDelta !== 0 ? fitDelta : remoteDelta;
      case "fit_latest_remote": return fitDelta !== 0 ? fitDelta : remoteDelta !== 0 ? remoteDelta : dateDelta;
      case "fit":               return fitDelta;
      case "latest":            return dateDelta;
      case "salary":            return (salaryB as number) - (salaryA as number);
      case "resume_ready": {
        const readyA = a.resume_ready ? 1 : 0;
        const readyB = b.resume_ready ? 1 : 0;
        if (readyB !== readyA) return readyB - readyA;
        return (b.best_ats_score ?? 0) - (a.best_ats_score ?? 0);
      }
      case "direct_first": {
        const directA = _DIRECT_SOURCES.has(a.source) ? 1 : 0;
        const directB = _DIRECT_SOURCES.has(b.source) ? 1 : 0;
        if (directB !== directA) return directB - directA;
        return fitDelta !== 0 ? fitDelta : dateDelta;
      }
    }
  });
}

const TAB_LABELS: Record<string, string> = {
  active: "Active today",
  qualified: "Qualified jobs",
  remote: "Remote jobs",
  hybrid: "Hybrid jobs",
  onsite: "On-site jobs",
  archived: "Archived jobs",
  direct: "Direct portal jobs",
  ready: "Resume-ready jobs",
};

function JobsSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="grid gap-4 border-b pb-4 md:grid-cols-[1fr_160px_120px_90px]">
            <div className="space-y-2">
              <Skeleton className="h-4 w-72 max-w-full" />
              <Skeleton className="h-3 w-44" />
            </div>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function JobsClient() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<JobProfile[]>(defaultProfiles);
  const [profileId, setProfileId] = useState("dotnet");
  const [rankedJobs, setRankedJobs] = useState<Job[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState(defaultProfiles[0]?.searchTerm ?? ".NET developer");
  const [location, setLocation] = useState("");
  const [source, setSource] = useState("all");
  const [visaStatus, setVisaStatus] = useState("all");
  const [postedWithin, setPostedWithin] = useState("24h"); // all | 24h | 3d | 7d | 14d
  const [priorityTier, setPriorityTier] = useState("all"); // all | remote | texas | nc | usa
  const [filterCity, setFilterCity] = useState("all");
  const [filterRun, setFilterRun] = useState("all"); // "all" | ISO bucket string (15-min window)
  const [apiCollectionRuns, setApiCollectionRuns] = useState<{ bucket: string; count: number; label: string }[]>([]);
  const [tab, setTab] = useState("active");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [availableSources, setAvailableSources] = useState<{ source: string; job_count: number }[]>([]);
  const [lastSearchMode, setLastSearchMode] = useState<"feed" | "search">("feed");
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [generationType, setGenerationType] = useState<"resume" | "cover_letter" | "both">("resume");
  const [generationModel, setGenerationModel] = useState("gemini|gemini-2.5-flash");
  const [queueingDocuments, setQueueingDocuments] = useState(false);
  const [generationJobs, setGenerationJobs] = useState<AIGenerationJob[]>([]);
  const [sortPreset, setSortPreset] = useState<SortPreset>("best");
  const [tableSortKey, setTableSortKey] = useState<SortKey>("best");
  const [tableSortDir, setTableSortDir] = useState<SortDir>("desc");
  const modelChoices = useMemo(() => resumeModelChoices(), []);

  // Derive state counts from loaded jobs — used to populate the state dropdown.
  const stateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of rankedJobs) {
      const loc = normalize(job.location);
      if (isRemoteJob(job, loc)) {
        counts.set("remote", (counts.get("remote") ?? 0) + 1);
      } else {
        const s = extractState(job.location);
        if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    return counts;
  }, [rankedJobs]);

  // City counts for the currently selected state.
  const cityCounts = useMemo(() => {
    if (priorityTier === "all" || priorityTier === "remote") return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const job of rankedJobs) {
      if (extractState(job.location) !== priorityTier) continue;
      const city = extractCity(job.location);
      if (city) counts.set(city, (counts.get(city) ?? 0) + 1);
    }
    return counts;
  }, [rankedJobs, priorityTier]);


  useEffect(() => {
    setProfiles(loadProfiles());
    // Load all available sources from DB for the source dropdown
    import("@/lib/api").then(({ getSourceCounts }) =>
      getSourceCounts().then((rows) => setAvailableSources(rows.sort((a, b) => b.job_count - a.job_count)))
    ).catch(() => {});
    // Load initial collection run buckets (no keyword yet — keyword loads after profile is set)
    loadCollectionRuns(null);
    getDocumentGenerationJobs(25).then(setGenerationJobs).catch(() => {});
  }, []);

  // Poll while any job is queued or running; refresh job list when newly completed
  const prevGenJobsRef = useRef<AIGenerationJob[]>([]);
  useEffect(() => {
    const active = generationJobs.some((j) => j.status === "queued" || j.status === "running");
    // Check if any job newly completed since last render
    const newlyDone = generationJobs.some((j) =>
      j.status === "completed" &&
      !prevGenJobsRef.current.find((p) => p.id === j.id && p.status === "completed")
    );
    prevGenJobsRef.current = generationJobs;
    if (newlyDone) {
      // Refresh jobs to pick up updated best_ats_score / resume_ready badge
      loadSearchPage(page).catch(() => {});
      setCompletedExpanded(true);
    }
    if (!active) return;
    const id = setInterval(() => {
      getDocumentGenerationJobs(25).then(setGenerationJobs).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [generationJobs]);

  function loadCollectionRuns(_kw: string | null) {
    // Always show total batch counts (not keyword-filtered) so user sees "402 new" matching the Collect page
    getCollectionRuns(null).then((runs) => {
      const labeled = runs.map(({ bucket, count }) => {
        // bucket is "2026-06-15 18:45" UTC
        const d = new Date(bucket.replace(" ", "T") + ":00Z");
        const formatted = d.toLocaleString("en-US", {
          timeZone: "America/Chicago",
          month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit", hour12: true,
        });
        const month = parseInt(d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric" }));
        const tz = month >= 3 && month <= 11 ? "CDT" : "CST";
        return { bucket, count, label: `${formatted} ${tz}` };
      });
      setApiCollectionRuns(labeled);
    }).catch(() => {});
  }

  // Build the keyword OR string from a profile's preferredTitles.
  function profileKeyword(profile: JobProfile) {
    return profile.preferredTitles.length > 0
      ? profile.preferredTitles.join(" OR ")
      : profile.searchTerm;
  }

  function pageJobs(items: Job[], nextPage: number, size = pageSize) {
    if (size === 0) return items; // 0 = "All"
    return items.slice(nextPage * size, nextPage * size + size);
  }

  function withinWindow(job: Job, window: string) {
    if (window === "all") return true;
    const hours: Record<string, number> = { "24h": 24, "3d": 72, "7d": 168, "14d": 336 };
    const cutoff = Date.now() - (hours[window] ?? 0) * 3_600_000;
    const posted = postedTime(job);
    return posted > 0 && posted >= cutoff;
  }

  function matchesLocation(job: Job, state: string, city: string): boolean {
    if (state === "all") return true;
    const loc = normalize(job.location);
    if (state === "remote") return isRemoteJob(job, loc);
    const jobState = extractState(job.location);
    if (jobState !== state) return false;
    if (city === "all") return true;
    const jobCity = extractCity(job.location);
    return normalize(jobCity).includes(normalize(city));
  }

  function setRankedJobFeed(items: Job[], nextPage: number, state = priorityTier, city = filterCity, preset = sortPreset) {
    const sorted = applyPresetSort(prioritizeJobs(items), preset);
    const filtered = sorted.filter((job) => withinWindow(job, postedWithin) && matchesLocation(job, state, city));
    const visibleJobs = pageJobs(filtered, nextPage);
    setRankedJobs(sorted);
    setJobs(visibleJobs);
    setSelectedJob((current) => current && visibleJobs.some((job) => job.id === current.id) ? current : null);
  }

  function prioritizeJobs(items: Job[]) {
    return [...items].sort((left, right) => {
      const priorityDelta = jobPriority(right) - jobPriority(left);
      if (priorityDelta !== 0) return priorityDelta;
      return postedTime(right) - postedTime(left);
    });
  }

  function jobPriority(job: Job) {
    const text = `${job.title} ${job.description ?? ""} ${job.job_type ?? ""} ${job.visa_status}`.toLowerCase();
    let score = locationWorkVisaPriority(job);
    if (isPlaceholderJob(job)) score -= 200_000;
    if (isVisaFriendly(job)) score += 1000;
    if (text.includes("contract") || text.includes("full-time") || text.includes("full time") || text.includes("w2") || text.includes("c2c")) score += 120;
    score += job.fit_score;
    score += Math.min(postedTime(job) / 86_400_000, 30);
    return score;
  }

  // Auto-search on mount with the default profile keywords, no location filter.
  useEffect(() => {
    const profile = defaultProfiles.find((p) => p.id === "dotnet") ?? defaultProfiles[0];
    if (!profile) return;
    const kw = profileKeyword(profile);
    setKeyword(kw);
    loadCollectionRuns(kw); // reload counts filtered by default profile keyword
    let active = true;
    setLoading(true);
    searchJobs({
      keyword: kw,
      location: null,
      source: null,
      visa_status: null,
      work_mode: null,
      qualification_status: null,
      limit: CANDIDATE_LIMIT,
      offset: 0,
    })
      .then((items) => {
        if (!active) return;
        setRankedJobFeed(items, 0);
        setPage(0);
        setLastSearchMode("search");
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Could not load jobs");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function searchPayload(nextPage = 0) {
    return {
      keyword: keyword.trim() ? expandSearchTerm(keyword) : null,
      location: location.trim() || null,
      source: source === "all" || source === "direct" ? null : source,
      visa_status: visaStatus === "all" ? null : visaStatus,
      work_mode: tab === "remote" ? "Remote" : tab === "hybrid" ? "Hybrid" : tab === "onsite" ? "On-site" : null,
      qualification_status: tab === "qualified" ? "Qualified" : tab === "disqualified" ? "Disqualified" : null,
      limit: CANDIDATE_LIMIT,
      offset: 0,
    };
  }

  async function loadSearchPage(nextPage: number) {
    setLoading(true);
    try {
      const payload = searchPayload(nextPage);
      let nextJobs = await searchJobs(payload);
      if (nextJobs.length === 0 && payload.location) {
        nextJobs = await searchJobs({ ...payload, location: null });
      }
      if (source === "direct") {
        nextJobs = nextJobs.filter((j) => _DIRECT_SOURCES.has(j.source));
      }
      setRankedJobFeed(nextJobs, nextPage);
      setPage(nextPage);
      setLastSearchMode("search");
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function runSearch() {
    await loadSearchPage(0);
  }

  async function loadArchived() {
    setLoading(true);
    setError(null);
    try {
      const items = await getArchivedJobs(keyword.trim() || undefined);
      setRankedJobs(items);
      setJobs(pageSize === 0 ? items : items.slice(0, pageSize));
      setPage(0);
      setSelectedJob(null);
      setLastSearchMode("search");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load archived jobs");
    } finally {
      setLoading(false);
    }
  }

  async function loadDirect() {
    setLoading(true);
    setError(null);
    try {
      const items = await getDirectJobs(500);
      setRankedJobs(items);
      setJobs(pageSize === 0 ? items : items.slice(0, pageSize));
      setPage(0);
      setSelectedJob(null);
      setLastSearchMode("search");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load direct jobs");
    } finally {
      setLoading(false);
    }
  }

  async function handleTriggerDirectScrape() {
    try {
      const res = await triggerDirectScrape();
      toast.success(res.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to trigger scrape");
    }
  }

  const [autoQueuing, setAutoQueuing] = useState(false);
  const [deletingGenJobId, setDeletingGenJobId] = useState<number | null>(null);
  const [requeueingGenJobId, setRequeuingGenJobId] = useState<number | null>(null);
  const [deletingAllCompleted, setDeletingAllCompleted] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [completedPage, setCompletedPage] = useState(0);
  const COMPLETED_PER_PAGE = 10;

  async function handleDeleteGenerationJob(id: number) {
    setDeletingGenJobId(id);
    try {
      await deleteGenerationJob(id);
      setGenerationJobs((current) => current.filter((j) => j.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingGenJobId(null);
    }
  }

  async function handleDeleteAllCompleted() {
    const completed = generationJobs.filter((j) => j.status === "completed");
    setDeletingAllCompleted(true);
    try {
      await Promise.all(completed.map((j) => deleteGenerationJob(j.id)));
      setGenerationJobs((current) => current.filter((j) => j.status !== "completed"));
      setCompletedExpanded(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete all failed");
    } finally {
      setDeletingAllCompleted(false);
    }
  }

  async function handleRequeueGenerationJob(id: number) {
    setRequeuingGenJobId(id);
    try {
      const updated = await requeueGenerationJob(id);
      setGenerationJobs((current) => current.map((j) => j.id === id ? updated : j));
      toast.success("Job requeued");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Requeue failed");
    } finally {
      setRequeuingGenJobId(null);
    }
  }

  async function goToJobInTable(jobId: number) {
    const existing = rankedJobs.find((j) => j.id === jobId);
    if (existing) {
      setSelectedJob(existing);
      return;
    }
    try {
      const { getJob } = await import("@/lib/api");
      const job = await getJob(jobId);
      setSelectedJob(job);
    } catch {
      toast.error("Could not load job");
    }
  }

  async function loadReady() {
    setLoading(true);
    setError(null);
    try {
      const { getJobs } = await import("@/lib/api");
      const items = await getJobs(500);
      const ready = items.filter((j) => j.resume_ready);
      ready.sort((a, b) => (b.best_ats_score ?? 0) - (a.best_ats_score ?? 0));
      setRankedJobs(ready);
      setJobs(pageSize === 0 ? ready : ready.slice(0, pageSize));
      setPage(0);
      setSelectedJob(null);
      setLastSearchMode("search");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load ready jobs");
    } finally {
      setLoading(false);
    }
  }

  async function handleAutoQueueTop() {
    setAutoQueuing(true);
    try {
      const { autoQueueTopJobs } = await import("@/lib/api");
      const res = await autoQueueTopJobs(10, 60);
      const latest = await getDocumentGenerationJobs(25);
      setGenerationJobs(latest);
      toast.success(res.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-queue failed");
    } finally {
      setAutoQueuing(false);
    }
  }

  async function goToPage(nextPage: number) {
    if (nextPage < 0) return;
    if (lastSearchMode === "search") {
      await loadSearchPage(nextPage);
      return;
    }
    const visibleJobs = pageJobs(rankedJobs.filter((job) => withinWindow(job, postedWithin) && matchesLocation(job, priorityTier, filterCity)), nextPage);
    setJobs(visibleJobs);
    setSelectedJob((current) => current && visibleJobs.some((job) => job.id === current.id) ? current : null);
    setPage(nextPage);
  }

  // Re-apply filters + page size without re-fetching whenever filter state changes.
  useEffect(() => {
    if (rankedJobs.length === 0) return;
    const filtered = rankedJobs.filter((job) => withinWindow(job, postedWithin) && matchesLocation(job, priorityTier, filterCity));
    const visibleJobs = pageJobs(filtered, 0, pageSize);
    setJobs(visibleJobs);
    setPage(0);
    setSelectedJob((current) => current && visibleJobs.some((job) => job.id === current.id) ? current : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postedWithin, priorityTier, filterCity, pageSize]);

  async function applyJob(job: Job) {
    try {
      await markJobApplied(job.id, { status: "Applied", notes: "Marked applied from Next UI" });
      setRankedJobs((current) => current.filter((item) => item.id !== job.id));
      setJobs((current) => {
        const remaining = current.filter((item) => item.id !== job.id);
        setSelectedJob((selected) => selected?.id === job.id ? null : selected);
        return remaining;
      });
      toast.success("Job moved to Applications");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not mark applied");
    }
  }

  function toggleJobSelection(job: Job) {
    setSelectedJobIds((current) => {
      const next = new Set(current);
      if (next.has(job.id)) next.delete(job.id);
      else next.add(job.id);
      return next;
    });
  }

  function toggleVisibleSelection(visibleJobs: Job[]) {
    setSelectedJobIds((current) => {
      const next = new Set(current);
      const allVisibleSelected = visibleJobs.length > 0 && visibleJobs.every((job) => next.has(job.id));
      for (const job of visibleJobs) {
        if (allVisibleSelected) next.delete(job.id);
        else next.add(job.id);
      }
      return next;
    });
  }

  async function generateSelectedDocuments() {
    const selectedProfile = profiles.find((profile) => profile.id === profileId);
    const baseResume = selectedProfile?.baseResume?.trim();
    if (!baseResume || baseResume.length < 50) {
      toast.error("Add a base resume to this profile in Resume Lab first");
      return;
    }
    const jobIds = Array.from(selectedJobIds);
    if (jobIds.length === 0) {
      toast.error("Select at least one job");
      return;
    }
    const [provider, model] = generationModel.split("|");
    setQueueingDocuments(true);
    try {
      const result = await queueDocumentGeneration({
        job_ids: jobIds,
        generation_type: generationType,
        base_resume: baseResume,
        profile_name: selectedProfile?.name ?? profileId,
        provider: provider ?? null,
        model: model ?? null,
      });
      setSelectedJobIds(new Set());
      const latest = await getDocumentGenerationJobs(25);
      setGenerationJobs(latest);
      toast.success(`Queued ${result.queued} document job${result.queued === 1 ? "" : "s"}`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not queue document generation");
    } finally {
      setQueueingDocuments(false);
    }
  }

  function openResumeLab(job: Job) {
    const description = job.description?.trim() || "";
    window.localStorage.setItem("resumeLabJob", JSON.stringify({
      id: job.id,
      title: job.title,
      company: job.company_name,
      location: job.location,
      jobUrl: job.job_url,
      description,
      returnTo: "/jobs",
    }));
    window.open(`/resume-lab?jobId=${job.id}`, "_blank", "noopener");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-sky-700 dark:text-sky-300">Jobs</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Active job feed</h1>
        </div>
        <Badge variant="secondary" className="w-fit">{rankedJobs.length.toLocaleString()} matching jobs</Badge>
      </div>
      <div className="surface rounded-lg p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
          <Select
            value={profileId}
            onValueChange={(value) => {
              setProfileId(value);
              const profile = profiles.find((item) => item.id === value);
              if (!profile) return;
              const kw = profileKeyword(profile);
              setKeyword(kw);
              setLocation("");
              setFilterRun("all"); // reset collection filter when profile changes
              loadCollectionRuns(kw); // reload counts filtered by new profile keyword
              // Auto-search with all profile keywords, no location filter.
              setLoading(true);
              setError(null);
              searchJobs({
                keyword: kw,
                location: null,
                source: source === "all" ? null : source,
                visa_status: visaStatus === "all" ? null : visaStatus,
                work_mode: tab === "remote" ? "Remote" : tab === "hybrid" ? "Hybrid" : tab === "onsite" ? "On-site" : null,
                qualification_status: tab === "qualified" ? "Qualified" : tab === "disqualified" ? "Disqualified" : null,
                limit: CANDIDATE_LIMIT,
                offset: 0,
              })
                .then((items) => {
                  setRankedJobFeed(items, 0);
                  setPage(0);
                  setLastSearchMode("search");
                })
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Search failed"))
                .finally(() => setLoading(false));
            }}
          >
            <SelectTrigger><SelectValue placeholder="Profile" /></SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder=".NET developer, Java developer" aria-label="Keyword" />
          <Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Remote or Dallas, TX" aria-label="Location" />
<Select value={source} onValueChange={setSource}>
            <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="direct">Direct portals (Greenhouse/Lever/Ashby)</SelectItem>
              {availableSources.map(({ source: s, job_count }) => (
                <SelectItem key={s} value={s}>{s} · {job_count.toLocaleString()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={postedWithin} onValueChange={setPostedWithin}>
            <SelectTrigger><SelectValue placeholder="Posted within" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any time</SelectItem>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="3d">Last 3 days</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="14d">Last 14 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Location filter: State → City (both dynamic from job data) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={priorityTier} onValueChange={(v) => { setPriorityTier(v); setFilterCity("all"); }}>
            <SelectTrigger className="w-52"><SelectValue placeholder="All states" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {stateCounts.get("remote") ? (
                <SelectItem value="remote">Remote only ({stateCounts.get("remote")})</SelectItem>
              ) : null}
              {Array.from(stateCounts.entries())
                .filter(([s]) => s !== "remote")
                .sort((a, b) => b[1] - a[1])
                .map(([state, count]) => (
                  <SelectItem key={state} value={state}>{state} ({count})</SelectItem>
                ))}
            </SelectContent>
          </Select>
          {priorityTier !== "all" && priorityTier !== "remote" && cityCounts.size > 0 && (
            <Select value={filterCity} onValueChange={setFilterCity}>
              <SelectTrigger className="w-52"><SelectValue placeholder={`All ${priorityTier} cities`} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All {priorityTier} cities</SelectItem>
                {Array.from(cityCounts.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([city, count]) => (
                    <SelectItem key={city} value={city}>{city} ({count})</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
          {apiCollectionRuns.length > 0 && (
            <Select
              value={filterRun}
              onValueChange={(value) => {
                setFilterRun(value);
                if (value === "all") {
                  // Return to normal search
                  setLoading(true);
                  const kw = keyword.trim() ? expandSearchTerm(keyword) : null;
                  searchJobs({ keyword: kw, location: null, source: null, visa_status: null, work_mode: null, qualification_status: null, limit: CANDIDATE_LIMIT, offset: 0 })
                    .then((items) => { setRankedJobFeed(items, 0); setPage(0); setLastSearchMode("search"); })
                    .catch((e: unknown) => setError(e instanceof Error ? e.message : "Load failed"))
                    .finally(() => setLoading(false));
                } else {
                  // Fetch ALL jobs first_seen in this 15-min bucket — no keyword filter
                  // (the batch may contain any source/title; keyword would exclude most)
                  setLoading(true);
                  setJobs([]);  // clear stale results immediately
                  setRankedJobs([]);
                  // No keyword filter — all jobs in this batch were already collected by profile
                  // search keywords, so all are relevant regardless of title wording
                  getJobsByRun(value, null)
                    .then((items) => { setRankedJobFeed(items, 0); setPage(0); setLastSearchMode("search"); })
                    .catch((e: unknown) => setError(e instanceof Error ? e.message : "Load failed"))
                    .finally(() => setLoading(false));
                }
              }}
            >
              <SelectTrigger className="w-60"><SelectValue placeholder="All collections" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All collections</SelectItem>
                {apiCollectionRuns.map(({ bucket, label, count }) => (
                  <SelectItem key={bucket} value={bucket}>{label} · {count} jobs</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <Tabs value={tab} onValueChange={(value) => {
            setTab(value);
            if (value === "archived") loadArchived();
            if (value === "direct") loadDirect();
            if (value === "ready") loadReady();
          }}>
            <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg p-1 md:w-auto">
              <TabsTrigger value="active">Active today</TabsTrigger>
              <TabsTrigger value="qualified">Qualified</TabsTrigger>
              <TabsTrigger value="remote">Remote</TabsTrigger>
              <TabsTrigger value="hybrid">Hybrid</TabsTrigger>
              <TabsTrigger value="onsite">On-site</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
              <TabsTrigger value="direct">Direct portals</TabsTrigger>
              <TabsTrigger value="ready" className="font-semibold text-green-700 data-[state=active]:text-green-700 dark:text-green-400">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Resume Ready
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap gap-2">
            {tab === "direct" && (
              <Button variant="outline" size="sm" onClick={handleTriggerDirectScrape}>
                Refresh now
              </Button>
            )}
            {tab === "ready" && (
              <Button variant="outline" size="sm" onClick={loadReady}>
                Refresh
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleAutoQueueTop}
              disabled={autoQueuing}
              title="Queue resume generation for top 10 high-fit jobs that don't have a resume yet"
            >
              {autoQueuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Queue Top 10
            </Button>
            <Button onClick={runSearch} disabled={loading || tab === "archived" || tab === "direct" || tab === "ready"}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
          </div>
        </div>
      </div>
      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}
      <div className={selectedJob ? "grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]" : "grid min-w-0 gap-4"}>
        <div className="min-w-0 space-y-3">
          <Card className="surface rounded-lg shadow-sm">
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium">AI document queue</p>
                  {selectedJobIds.size > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {selectedJobIds.size} selected — missing JDs fetched from job URL first.
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select value={generationType} onValueChange={(value: "resume" | "cover_letter" | "both") => setGenerationType(value)}>
                    <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="resume">Resume only</SelectItem>
                      <SelectItem value="cover_letter">Cover letter only</SelectItem>
                      <SelectItem value="both">Resume + cover letter</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={generationModel} onValueChange={setGenerationModel}>
                    <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {modelChoices.map((choice) => (
                        <SelectItem key={`${choice.provider}|${choice.model}`} value={`${choice.provider}|${choice.model}`}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={generateSelectedDocuments} disabled={queueingDocuments || selectedJobIds.size === 0}>
                    {queueingDocuments ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Generate
                  </Button>
                </div>
              </div>
              {/* Pending / running / failed jobs */}
              {generationJobs.filter((j) => j.status !== "completed").length > 0 && (
                <div className="rounded-lg border bg-background/60 p-3">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">In progress</p>
                  <div className="space-y-1.5">
                    {generationJobs.filter((j) => j.status !== "completed").map((j) => (
                      <div key={j.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{j.company_name ?? j.job_title ?? `Job ${j.job_id}`}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`font-medium ${j.status === "running" ? "text-blue-500" : j.status === "failed" ? "text-red-500" : "text-muted-foreground"}`}>
                            {j.status}
                          </span>
                          {(j.status === "failed" || j.status === "running") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-primary"
                              title="Rerun"
                              aria-label={`Rerun document generation for ${j.company_name ?? j.job_title ?? `job ${j.job_id}`}`}
                              disabled={requeueingGenJobId === j.id}
                              onClick={() => handleRequeueGenerationJob(j.id)}
                            >
                              {requeueingGenJobId === j.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Completed jobs (with resume built) — collapsible, auto-hidden by default */}
              {generationJobs.filter((j) => j.status === "completed").length > 0 && (
                <div className="rounded-lg border bg-background/60 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setCompletedExpanded((v) => !v)}
                      >
                        {completedExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        Resumes built ({generationJobs.filter((j) => j.status === "completed").length})
                      </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                      disabled={deletingAllCompleted}
                      onClick={handleDeleteAllCompleted}
                    >
                      {deletingAllCompleted ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete all"}
                    </Button>
                  </div>
                  {completedExpanded && (() => {
                    const allCompleted = generationJobs.filter((j) => j.status === "completed");
                    const totalPages = Math.ceil(allCompleted.length / COMPLETED_PER_PAGE);
                    const paged = allCompleted.slice(completedPage * COMPLETED_PER_PAGE, (completedPage + 1) * COMPLETED_PER_PAGE);
                    return (
                      <div className="space-y-1.5 mt-2">
                        {paged.map((j) => (
                          <div key={j.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="flex min-w-0 items-center gap-1 truncate text-green-700 dark:text-green-400">
                              <CheckCircle2 className="h-3 w-3 shrink-0" />
                              {j.company_name ?? j.job_title ?? `Job ${j.job_id}`}
                              {j.generation_type === "resume" ? " · Resume" : j.generation_type === "cover_letter" ? " · Cover letter" : " · Resume + CL"}
                            </span>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-muted-foreground hover:text-primary" title="Go to job" aria-label={`Go to job ${j.job_id}`} onClick={() => goToJobInTable(j.job_id)}>
                                <ArrowUpRight className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" title="Delete" disabled={deletingGenJobId === j.id} onClick={() => handleDeleteGenerationJob(j.id)}>
                                {deletingGenJobId === j.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                              </Button>
                            </div>
                          </div>
                        ))}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                            <span>{completedPage + 1} / {totalPages}</span>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={completedPage === 0} onClick={() => setCompletedPage((p) => p - 1)}>Prev</Button>
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={completedPage >= totalPages - 1} onClick={() => setCompletedPage((p) => p + 1)}>Next</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Sort</span>
            {SORT_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => {
                  setSortPreset(p.value);
                  const resorted = applyPresetSort(
                    rankedJobs.filter((job) => withinWindow(job, postedWithin) && matchesLocation(job, priorityTier, filterCity)),
                    p.value,
                  );
                  setJobs(pageSize === 0 ? resorted : resorted.slice(0, pageSize));
                  setPage(0);
                }}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  sortPreset === p.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {loading ? (
            <JobsSkeleton />
          ) : (
            <JobTable
              jobs={jobs}
              onApply={applyJob}
              onSelect={setSelectedJob}
              selectedJobIds={selectedJobIds}
              onToggleJobSelection={toggleJobSelection}
              onToggleVisibleSelection={toggleVisibleSelection}
              selectedJobId={selectedJob?.id ?? null}
              title={TAB_LABELS[tab] ?? "Jobs"}
              sortKey={tableSortKey}
              sortDir={tableSortDir}
              onSort={(key, dir) => {
                setTableSortKey(key);
                setTableSortDir(dir);
                // Re-sort full rankedJobs by the column, then re-page
                const filtered = rankedJobs.filter((job) => withinWindow(job, postedWithin) && matchesLocation(job, priorityTier, filterCity));
                // Import sortJobs logic inline for the key sorts
                const sorted = key === "best"
                  ? applyPresetSort(filtered, "best")
                  : [...filtered].sort((a, b) => {
                      const sign = dir === "asc" ? 1 : -1;
                      switch (key) {
                        case "title":    return (a.title ?? "").localeCompare(b.title ?? "") * sign;
                        case "company":  return (a.company_name ?? "").localeCompare(b.company_name ?? "") * sign;
                        case "fit":      return ((a.fit_score ?? 0) - (b.fit_score ?? 0)) * sign;
                        case "visa":     return (({ High: 3, Medium: 2, Low: 1, Unknown: 0 }[a.visa_score ?? ""] ?? 0) - ({ High: 3, Medium: 2, Low: 1, Unknown: 0 }[b.visa_score ?? ""] ?? 0)) * sign;
                        case "posted":   return (Date.parse(a.date_posted ?? "") - Date.parse(b.date_posted ?? "")) * sign;
                        case "collected":return (Date.parse(a.first_seen_at ?? "") - Date.parse(b.first_seen_at ?? "")) * sign;
                        default:         return 0;
                      }
                    });
                setRankedJobs(sorted);
                setJobs(pageSize === 0 ? sorted : sorted.slice(page * pageSize, (page + 1) * pageSize));
              }}
            />
          )}
          <div className="flex flex-col gap-3 rounded-xl border bg-card/70 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-muted-foreground">
              {pageSize === 0 ? `${rankedJobs.length.toLocaleString()} total (all shown)` : `Page ${page + 1} · ${jobs.length} shown · ${rankedJobs.length.toLocaleString()} total`}
              {priorityTier !== "all" && (
                <span className="text-primary font-medium">
                  {" · "}{priorityTier === "remote" ? "Remote" : priorityTier === "texas" ? "Texas" : "NC"}
                  {filterCity !== "all" && ` › ${filterCity.replace(/\b\w/g, (c) => c.toUpperCase())}`}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 / page</SelectItem>
                  <SelectItem value="60">60 / page</SelectItem>
                  <SelectItem value="90">90 / page</SelectItem>
                  <SelectItem value="120">120 / page</SelectItem>
                  <SelectItem value="0">All</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => goToPage(page - 1)} disabled={loading || page === 0 || pageSize === 0}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => goToPage(page + 1)} disabled={loading || pageSize === 0 || (page + 1) * pageSize >= rankedJobs.length}>Next</Button>
            </div>
          </div>
        </div>
        {selectedJob ? <JobDetailsPanel job={selectedJob} onApply={applyJob} onResumeLab={openResumeLab} onClose={() => setSelectedJob(null)} /> : null}
      </div>
    </div>
  );
}

function JobDetailsPanel({
  job,
  onApply,
  onResumeLab,
  onClose,
}: {
  job: Job | null;
  onApply: (job: Job) => void;
  onResumeLab: (job: Job) => void;
  onClose: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [coldEmailOpen, setColdEmailOpen] = useState(false);
  const [coldEmailLoading, setColdEmailLoading] = useState(false);
  const [coldEmail, setColdEmail] = useState<ColdEmailResult | null>(null);
  const [recruiterName, setRecruiterName] = useState("");
  const [recruiterEmail, setRecruiterEmail] = useState("");
  const [contactRole, setContactRole] = useState("Recruiter");
  const [outreachTone, setOutreachTone] = useState("concise");
  const [candidateSummary, setCandidateSummary] = useState("Senior .NET/Azure developer with experience in ASP.NET Core, C#, Azure, SQL Server, React, Angular, APIs, microservices, and enterprise delivery.");
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [documents, setDocuments] = useState<JobDocuments | null>(null);
  const canEmbedPreview = job?.job_url ? canEmbedJobUrl(job.job_url) : false;

  useEffect(() => {
    setNotes("");
    setColdEmail(null);
    setRecruiterName("");
    setRecruiterEmail("");
    setContactRole("Recruiter");
    setOutreachTone("concise");
    setDocuments(null);
    if (job?.id) {
      getJobDocuments(job.id).then(setDocuments).catch(() => {});
    }
  }, [job?.id]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSaveNotes() {
    if (!job || !notes.trim()) return;
    setSavingNotes(true);
    try {
      await saveJobNotes(job.id, notes.trim());
      toast.success("Notes saved");
    } catch {
      toast.error("Could not save notes");
    } finally {
      setSavingNotes(false);
    }
  }

  function jobDetailsText() {
    if (!job) return "";
    return [
      `Title: ${job.title}`,
      `Company: ${job.company_name ?? "Unknown"}`,
      `Location: ${job.location ?? "Not listed"}`,
      `Source: ${job.source}`,
      `Job type: ${job.job_type ?? "Not listed"}`,
      `Visa: ${job.visa_status} (${job.visa_score})`,
      `URL: ${job.job_url ?? "Not listed"}`,
      "",
      "Job Description:",
      job.description?.trim() || "No stored job description. Open the job preview and copy from the employer page if available.",
    ].join("\n");
  }

  async function copyJobDetails() {
    await navigator.clipboard.writeText(jobDetailsText());
    toast.success("Job details copied");
  }

  function coldEmailText(result = coldEmail) {
    if (!result) return "";
    return [
      `Subject: ${result.subject}`,
      "",
      result.email_body,
      "",
      "LinkedIn message:",
      result.linkedin_message,
      "",
      "Follow-up:",
      result.follow_up_message,
    ].join("\n");
  }

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  }

  async function handleGenerateColdEmail() {
    if (!job) return;
    if (candidateSummary.trim().length < 20) {
      toast.error("Add a short candidate summary first");
      return;
    }
    setColdEmailLoading(true);
    try {
      const result = await generateColdEmail({
        job_title: job.title,
        company_name: job.company_name,
        job_description: job.description?.trim() || jobDetailsText(),
        candidate_summary: candidateSummary,
        recruiter_name: recruiterName || null,
        recruiter_email: recruiterEmail || null,
        contact_role: contactRole || null,
        tone: outreachTone,
      });
      setColdEmail(result);
      toast.success("Cold email generated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate cold email");
    } finally {
      setColdEmailLoading(false);
    }
  }

  async function saveColdEmailToNotes() {
    if (!job || !coldEmail) return;
    const text = coldEmailText(coldEmail);
    setSavingNotes(true);
    try {
      await saveJobNotes(job.id, text);
      setNotes(text);
      toast.success("Cold email saved to notes");
    } catch {
      toast.error("Could not save cold email notes");
    } finally {
      setSavingNotes(false);
    }
  }

  if (!job) {
    return (
      <Card className="surface h-fit shadow-none xl:sticky xl:top-24">
        <CardHeader>
          <CardTitle>Job details</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Select a job from the table to review the JD and send it to Resume Lab.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="surface h-fit shadow-none xl:sticky xl:top-24">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{job.source}</Badge>
            <Badge variant={job.visa_score === "High" ? "success" : job.visa_score === "Low" ? "destructive" : "warning"}>{job.visa_score}</Badge>
            <Badge variant="outline">{job.work_mode}</Badge>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={onClose} title="Close (Esc)">
            <span className="text-base leading-none">✕</span>
          </Button>
        </div>
        <div>
          <CardTitle className="leading-6">{job.title}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{job.company_name ?? "Unknown company"} | {job.location ?? "Location not listed"}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Posted</span><strong className="text-right font-medium">{formatDate(job.date_posted)}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Job type</span><strong className="text-right font-medium">{job.job_type ?? "Not listed"}</strong></div>
          {job.salary_display && (
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Salary</span><strong className="text-right font-medium">{job.salary_display}</strong></div>
          )}
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fit score</span><strong className="text-right font-medium">{job.fit_score}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Trust</span><strong className="text-right font-medium">{job.trust_status}</strong></div>
          {job.easy_apply && (
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Easy Apply</span><Badge variant="secondary" className="text-xs">Yes</Badge></div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onResumeLab(job)}>
            <FileText className="h-4 w-4" /> Edit resume
          </Button>
          <Button variant="outline" onClick={() => onApply(job)}><CheckCircle2 className="h-4 w-4" /> Mark applied</Button>
          <Button variant="outline" onClick={copyJobDetails}><Copy className="h-4 w-4" /> Copy JD</Button>
          <Button variant="outline" onClick={() => setColdEmailOpen(true)}><Mail className="h-4 w-4" /> Cold email</Button>
          {job.job_url ? <Button variant="outline" onClick={() => setPreviewOpen(true)}><Search className="h-4 w-4" /> Preview</Button> : null}
          {job.job_url ? (
            <Button asChild variant="ghost">
              <a href={job.job_url} target="_blank" rel="noreferrer">
                Open job <ArrowUpRight className="h-4 w-4" />
              </a>
            </Button>
          ) : null}
        </div>

        {documents && (documents.resume_versions.length > 0 || documents.cover_letter_versions.length > 0) ? (
          <div className="rounded-lg border bg-background/70 p-3">
            <h3 className="mb-2 text-sm font-medium">Saved AI documents</h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              {documents.resume_versions.slice(0, 3).map((version) => (
                <div key={`resume-${version.id}`} className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="shrink-0">
                    Resume · {version.provider ?? "AI"} · {new Date(version.created_at).toLocaleString()}
                    {version.ats_after_score != null && (
                      <span className={`ml-2 font-semibold ${version.ats_after_score >= 85 ? "text-green-600" : version.ats_after_score >= 70 ? "text-yellow-600" : "text-red-500"}`}>
                        ATS {version.ats_after_score}%
                      </span>
                    )}
                  </span>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => copyText(version.content_text, "Resume copied")}>Copy</Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      const company = (version.company_name ?? job.company_name ?? "").replace(/[^a-z0-9]+/gi, "_");
                      const title = (version.job_title ?? job.title ?? "").replace(/[^a-z0-9]+/gi, "_");
                      const name = version.content_text.split("\n")[0]?.trim().replace(/\s+/g, "_") ?? "resume";
                      const filename = `${name}_${title}_${company}`.replace(/_+/g, "_").slice(0, 100);
                      exportResumeDocx(version.content_text, filename).then(({ blob, savedTo }) => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a"); a.href = url; a.download = `${filename}.docx`; a.click(); URL.revokeObjectURL(url);
                        toast.success(savedTo ? `Saved to ${savedTo}` : "Downloaded");
                      }).catch((e) => toast.error(String(e)));
                    }}>Download</Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      window.localStorage.setItem("resumeLabJob", JSON.stringify({
                        id: job.id, title: job.title, company: job.company_name,
                        location: job.location, jobUrl: job.job_url,
                        description: job.description ?? "", returnTo: "/jobs",
                        preloadedResume: version.content_text,
                      }));
                      window.open(`/resume-lab?jobId=${job.id}`, "_blank", "noopener");
                    }}>Refine ↗</Button>
                  </div>
                </div>
              ))}
              {documents.cover_letter_versions.slice(0, 3).map((version) => (
                <div key={`cover-${version.id}`} className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="shrink-0">Cover letter · {version.provider ?? "AI"} · {new Date(version.created_at).toLocaleString()}</span>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => copyText(version.content_text, "Cover letter copied")}>Copy</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <h3 className="mb-2 text-sm font-medium">Notes</h3>
          <div className="flex gap-2">
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a quick note..."
              className="text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveNotes(); }}
            />
            <Button size="sm" variant="outline" onClick={handleSaveNotes} disabled={savingNotes || !notes.trim()}>
              Save
            </Button>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Job description</h3>
          <div className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border bg-background/70 p-3 text-sm leading-6 text-muted-foreground">
            {job.description?.trim() || "No job description stored for this job yet."}
          </div>
        </div>

        <Dialog open={coldEmailOpen} onOpenChange={setColdEmailOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Recruiter cold email</DialogTitle>
              <DialogDescription>
                Generate copy-ready outreach for {job.company_name ?? "this company"}. This does not send email.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
              <div className="space-y-3">
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="recruiter-name">Recruiter name</label>
                  <Input id="recruiter-name" value={recruiterName} onChange={(event) => setRecruiterName(event.target.value)} placeholder="Optional, e.g. Priya" />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="recruiter-email">Recruiter email</label>
                  <Input id="recruiter-email" type="email" value={recruiterEmail} onChange={(event) => setRecruiterEmail(event.target.value)} placeholder="Optional" />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="contact-role">Contact type</label>
                  <Input id="contact-role" value={contactRole} onChange={(event) => setContactRole(event.target.value)} placeholder="Recruiter, hiring manager, referral contact" />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="outreach-tone">Tone</label>
                  <Select value={outreachTone} onValueChange={setOutreachTone}>
                    <SelectTrigger id="outreach-tone"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="concise">Concise</SelectItem>
                      <SelectItem value="warm">Warm</SelectItem>
                      <SelectItem value="direct">Direct</SelectItem>
                      <SelectItem value="referral-style">Referral-style</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="candidate-summary">Candidate summary</label>
                  <Textarea
                    id="candidate-summary"
                    value={candidateSummary}
                    onChange={(event) => setCandidateSummary(event.target.value)}
                    className="min-h-32 text-sm"
                    placeholder="Short truthful summary of your strongest fit for this job"
                  />
                </div>
                <Button onClick={handleGenerateColdEmail} disabled={coldEmailLoading} className="w-full">
                  {coldEmailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Generate outreach
                </Button>
              </div>
              <div className="space-y-3">
                {coldEmail ? (
                  <>
                    <div className="rounded-lg border bg-background/70 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-medium">Subject</h3>
                        <Button size="sm" variant="ghost" onClick={() => copyText(coldEmail.subject, "Subject copied")}><Copy className="h-4 w-4" /> Copy</Button>
                      </div>
                      <p className="text-sm text-muted-foreground">{coldEmail.subject}</p>
                    </div>
                    <div className="rounded-lg border bg-background/70 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-medium">Email body</h3>
                        <Button size="sm" variant="ghost" onClick={() => copyText(coldEmail.email_body, "Email copied")}><Copy className="h-4 w-4" /> Copy</Button>
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{coldEmail.email_body}</div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border bg-background/70 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className="text-sm font-medium">LinkedIn</h3>
                          <Button size="sm" variant="ghost" onClick={() => copyText(coldEmail.linkedin_message, "LinkedIn message copied")}><Copy className="h-4 w-4" /> Copy</Button>
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">{coldEmail.linkedin_message}</p>
                      </div>
                      <div className="rounded-lg border bg-background/70 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className="text-sm font-medium">Follow-up</h3>
                          <Button size="sm" variant="ghost" onClick={() => copyText(coldEmail.follow_up_message, "Follow-up copied")}><Copy className="h-4 w-4" /> Copy</Button>
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">{coldEmail.follow_up_message}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => copyText(coldEmailText(), "All outreach copied")}><Copy className="h-4 w-4" /> Copy all</Button>
                      <Button variant="outline" onClick={saveColdEmailToNotes} disabled={savingNotes}>
                        {savingNotes ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        Save to notes
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-96 items-center justify-center rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                    Add recruiter details if you have them, then generate a short email, LinkedIn note, and follow-up for this job.
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>{job.title}</DialogTitle>
            <DialogDescription>{job.company_name ?? "Unknown company"} | Use copy or open original when the employer blocks embedded previews.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copyJobDetails}><Copy className="h-4 w-4" /> Copy stored JD/details</Button>
              {job.job_url ? (
                <Button asChild>
                  <a href={job.job_url} target="_blank" rel="noreferrer">Open original <ArrowUpRight className="h-4 w-4" /></a>
                </Button>
              ) : null}
            </div>
            {job.job_url && canEmbedPreview ? (
              <iframe title={`Preview ${job.title}`} src={job.job_url} className="h-[620px] w-full rounded-lg border bg-background" />
            ) : (
              <div className="rounded-xl border bg-muted/40 p-6 text-sm leading-6 text-muted-foreground">
                <p className="font-medium text-foreground">This job site blocks embedded previews.</p>
                <p className="mt-2">
                  LinkedIn and many ATS/employer pages prevent opening inside another app, which causes browser messages like
                  {" "}“refused to connect.” Use <span className="font-medium text-foreground">Open original</span> to view the posting,
                  or <span className="font-medium text-foreground">Copy stored JD/details</span> to move the saved job text into Resume Lab.
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function locationWorkVisaPriority(job: Job) {
  const location = normalize(job.location);
  const visaFriendly = isVisaFriendly(job);
  const remote = isRemoteJob(job, location);
  const hybrid = normalize(job.work_mode).includes("hybrid") || normalize(job.job_type ?? "").includes("hybrid");

  if (remote && visaFriendly) return 100_000;
  if (hybrid && visaFriendly && isDfw(location)) return 90_000;
  if (isTexasMajorCity(location)) return 82_000;
  if (isNorthCarolina(location)) return 72_000;
  if (isTexas(location)) return 64_000;
  if (isNearbyTexasState(location)) return 54_000;
  if (isNearbyNcState(location)) return 48_000;
  if (isUnitedStates(location)) return 44_000;
  return 30_000;
}

function isPlaceholderJob(job: Job) {
  const title = normalize(job.title);
  const company = normalize(job.company_name);
  return title === "recommended jobs"
    || title === "search jobs"
    || title === "job"
    || (title.length < 4 && !company);
}

function isVisaFriendly(job: Job) {
  const text = normalize(`${job.visa_status} ${job.visa_score} ${job.description ?? ""} ${job.title}`);
  return job.visa_score === "High"
    || text.includes("sponsor")
    || text.includes("h1b")
    || text.includes("h-1b")
    || text.includes("tn visa")
    || text.includes("green card")
    || text.includes("visa friendly");
}

function isRemoteJob(job: Job, normalizedLocation = normalize(job.location)) {
  return Boolean(job.is_remote)
    || normalize(job.work_mode).includes("remote")
    || normalizedLocation.includes("remote")
    || normalizedLocation.includes("nationwide")
    || normalizedLocation.includes("anywhere");
}

function isDfw(location: string) {
  return [
    "dallas",
    "fort worth",
    "dfw",
    "plano",
    "frisco",
    "irving",
    "arlington",
    "richardson",
    "carrollton",
    "garland",
    "mckinney",
    "addison",
    "coppell",
    "lewisville",
  ].some((city) => location.includes(city));
}

function isTexasMajorCity(location: string) {
  return isDfw(location)
    || location.includes("austin")
    || location.includes("houston")
    || location.includes("san antonio")
    || location.includes("sanantonio");
}

function isTexas(location: string) {
  return isTexasMajorCity(location) || location.includes(" tx") || location.includes(",tx") || location.includes("texas");
}

function isNorthCarolina(location: string) {
  return location.includes("north carolina")
    || location.includes(" nc")
    || location.includes(",nc")
    || location.includes("charlotte")
    || location.includes("raleigh")
    || location.includes("durham")
    || location.includes("cary")
    || location.includes("research triangle");
}

function isNearbyTexasState(location: string) {
  return [
    "oklahoma", " ok", ",ok",
    "arkansas",  " ar", ",ar",
    "louisiana", " la", ",la",
    "new mexico"," nm", ",nm",
  ].some((token) => location.includes(token));
}

function isNearbyNcState(location: string) {
  return [
    "virginia",       " va", ",va",
    "south carolina", " sc", ",sc",
    "georgia",        " ga", ",ga",
    "tennessee",      " tn", ",tn",
  ].some((token) => location.includes(token));
}

function isUnitedStates(location: string) {
  return location.includes("united states") || /\b[A-Z]{2}\b/i.test(location);
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

const STATE_ABBR: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California",
  co: "Colorado", ct: "Connecticut", de: "Delaware", fl: "Florida", ga: "Georgia",
  hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
  ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland",
  ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi",
  mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire",
  nj: "New Jersey", nm: "New Mexico", ny: "New York", nc: "North Carolina",
  nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania",
  ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee",
  tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington",
  wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming", dc: "District of Columbia",
};

const STATE_NAME_TO_ABBR = Object.fromEntries(
  Object.entries(STATE_ABBR).map(([abbr, name]) => [name.toLowerCase(), abbr])
);

function extractState(location: string | null | undefined): string | null {
  const loc = normalize(location);
  const abbrMatch = loc.match(/,\s*([a-z]{2})(?:\s|$|,)/);
  const abbr1 = abbrMatch?.[1];
  if (abbr1 && STATE_ABBR[abbr1]) return STATE_ABBR[abbr1] ?? null;
  for (const [name, abbr] of Object.entries(STATE_NAME_TO_ABBR)) {
    if (loc.includes(name)) return STATE_ABBR[abbr] ?? null;
  }
  return null;
}

function extractCity(location: string | null | undefined): string | null {
  const raw = (location ?? "").trim();
  const match = raw.match(/^(.+?),\s*[A-Z]{2}/);
  return match?.[1]?.trim() ?? null;
}

function postedTime(job: Job) {
  return Date.parse(job.date_posted ?? job.last_seen_at ?? job.first_seen_at ?? "") || 0;
}

function canEmbedJobUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ![
      "linkedin.com",
      "www.linkedin.com",
      "indeed.com",
      "www.indeed.com",
      "google.com",
      "www.google.com",
      "workdayjobs.com",
      "myworkdayjobs.com",
      "greenhouse.io",
      "boards.greenhouse.io",
      "lever.co",
      "jobs.lever.co",
      "metacareers.com",
      "www.metacareers.com",
    ].some((blockedHost) => host === blockedHost || host.endsWith(`.${blockedHost}`));
  } catch {
    return false;
  }
}
