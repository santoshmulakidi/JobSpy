"use client";

import { ArrowUpRight, CheckCircle2, Copy, FileText, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { JobTable } from "@/components/dashboard/job-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getArchivedJobs, getCollectionRuns, getJobsByRun, markJobApplied, saveJobNotes, searchJobs } from "@/lib/api";
import { compactLocation, defaultProfiles, expandSearchTerm, loadProfiles, type JobProfile } from "@/lib/job-profiles";
import { formatDate } from "@/lib/utils";
import type { Job } from "@/types/job";

const PAGE_SIZE = 30;
const CANDIDATE_LIMIT = 500;

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
  const [postedWithin, setPostedWithin] = useState("all"); // all | 24h | 3d | 7d | 14d
  const [priorityTier, setPriorityTier] = useState("all"); // all | remote | texas | nc | usa
  const [filterCity, setFilterCity] = useState("all");
  const [filterRun, setFilterRun] = useState("all"); // "all" | ISO bucket string (15-min window)
  const [apiCollectionRuns, setApiCollectionRuns] = useState<{ bucket: string; count: number; label: string }[]>([]);
  const [tab, setTab] = useState("active");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [availableSources, setAvailableSources] = useState<{ source: string; job_count: number }[]>([]);
  const [lastSearchMode, setLastSearchMode] = useState<"feed" | "search">("feed");

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
  }, []);

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

  function setRankedJobFeed(items: Job[], nextPage: number, state = priorityTier, city = filterCity) {
    const sorted = prioritizeJobs(items);
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
      source: source === "all" ? null : source,
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

  function openResumeLab(job: Job) {
    const description = job.description?.trim() || "";
    window.sessionStorage.setItem("resumeLabJob", JSON.stringify({
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
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Jobs</p>
        <h1 className="mt-1 text-3xl font-medium tracking-tight">Active job feed</h1>
      </div>
      <div className="surface rounded-2xl p-4">
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
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Tabs value={tab} onValueChange={(value) => {
            setTab(value);
            if (value === "archived") loadArchived();
          }}>
            <TabsList>
              <TabsTrigger value="active">Active today</TabsTrigger>
              <TabsTrigger value="qualified">Qualified</TabsTrigger>
              <TabsTrigger value="remote">Remote</TabsTrigger>
              <TabsTrigger value="hybrid">Hybrid</TabsTrigger>
              <TabsTrigger value="onsite">On-site</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={runSearch} disabled={tab === "archived"}>Search</Button>
        </div>
      </div>
      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}
      <div className={selectedJob ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]" : "grid gap-4"}>
        <div className="space-y-3">
          {loading ? (
            <JobsSkeleton />
          ) : (
            <JobTable
              jobs={jobs}
              onApply={applyJob}
              onSelect={setSelectedJob}
              selectedJobId={selectedJob?.id ?? null}
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
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const canEmbedPreview = job?.job_url ? canEmbedJobUrl(job.job_url) : false;

  useEffect(() => {
    setNotes("");
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
          {job.job_url ? <Button variant="outline" onClick={() => setPreviewOpen(true)}><Search className="h-4 w-4" /> Preview</Button> : null}
          {job.job_url ? (
            <Button asChild variant="ghost">
              <a href={job.job_url} target="_blank" rel="noreferrer">
                Open job <ArrowUpRight className="h-4 w-4" />
              </a>
            </Button>
          ) : null}
        </div>

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
