"use client";

import { ArrowUpRight, CheckCircle2, Copy, FileText, Search, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { getJobs, markJobApplied, searchJobs } from "@/lib/api";
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
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [source, setSource] = useState("all");
  const [visaStatus, setVisaStatus] = useState("all");
  const [tab, setTab] = useState("active");
  const [page, setPage] = useState(0);
  const [lastSearchMode, setLastSearchMode] = useState<"feed" | "search">("feed");

  useEffect(() => {
    setProfiles(loadProfiles());
  }, []);

  function pageJobs(items: Job[], nextPage: number) {
    return items.slice(nextPage * PAGE_SIZE, nextPage * PAGE_SIZE + PAGE_SIZE);
  }

  function setRankedJobFeed(items: Job[], nextPage: number) {
    const sorted = prioritizeJobs(items);
    const visibleJobs = pageJobs(sorted, nextPage);
    setRankedJobs(sorted);
    setJobs(visibleJobs);
    setSelectedJob((current) => current && visibleJobs.some((job) => job.id === current.id) ? current : visibleJobs[0] ?? null);
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
    if (isVisaFriendly(job)) score += 1000;
    if (text.includes("contract") || text.includes("full-time") || text.includes("full time") || text.includes("w2") || text.includes("c2c")) score += 120;
    score += job.fit_score;
    score += Math.min(postedTime(job) / 86_400_000, 30);
    return score;
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    getJobs(CANDIDATE_LIMIT, 0)
      .then((items) => {
        if (!active) return;
        setRankedJobFeed(items, page);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Could not load jobs");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page]);

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
      const nextJobs = await searchJobs(searchPayload(nextPage));
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

  async function goToPage(nextPage: number) {
    if (nextPage < 0) return;
    if (lastSearchMode === "search") {
      await loadSearchPage(nextPage);
      return;
    }
    const visibleJobs = pageJobs(rankedJobs, nextPage);
    setJobs(visibleJobs);
    setSelectedJob((current) => current && visibleJobs.some((job) => job.id === current.id) ? current : visibleJobs[0] ?? null);
    setPage(nextPage);
  }

  async function applyJob(job: Job) {
    try {
      await markJobApplied(job.id, { status: "Applied", notes: "Marked applied from Next UI" });
      setJobs((current) => {
        const remaining = current.filter((item) => item.id !== job.id);
        setSelectedJob((selected) => selected?.id === job.id ? remaining[0] ?? null : selected);
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
    router.push(`/resume-lab?jobId=${job.id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Jobs</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Active 24-hour job feed</h1>
        </div>
        <Button>
          <SlidersHorizontal className="h-4 w-4" /> Advanced filters
        </Button>
      </div>
      <div className="surface rounded-2xl p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Select
            value={profileId}
            onValueChange={(value) => {
              setProfileId(value);
              const profile = profiles.find((item) => item.id === value);
              if (profile) {
                setKeyword(profile.searchTerm);
                setLocation(compactLocation(profile));
              }
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
          <Select value={visaStatus} onValueChange={setVisaStatus}>
            <SelectTrigger><SelectValue placeholder="Visa status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any visa status</SelectItem>
              <SelectItem value="H1B accepted">H1B accepted</SelectItem>
              <SelectItem value="Sponsorship available">Sponsorship available</SelectItem>
              <SelectItem value="USC/GC required">USC/GC required</SelectItem>
              <SelectItem value="Not specified">Not specified</SelectItem>
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
              <SelectItem value="indeed">Indeed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="active">Active today</TabsTrigger>
              <TabsTrigger value="qualified">Qualified</TabsTrigger>
              <TabsTrigger value="disqualified">Disqualified</TabsTrigger>
              <TabsTrigger value="remote">Remote</TabsTrigger>
              <TabsTrigger value="hybrid">Hybrid</TabsTrigger>
              <TabsTrigger value="onsite">On-site</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={runSearch}>Search</Button>
        </div>
      </div>
      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
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
              Page {page + 1} | {rankedJobs.length.toLocaleString()} ranked active jobs | Top order: Remote + visa, DFW hybrid + visa, Texas, NC, nearby states, USA
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => goToPage(page - 1)} disabled={loading || page === 0}>Previous</Button>
              <Button variant="outline" onClick={() => goToPage(page + 1)} disabled={loading || (page + 1) * PAGE_SIZE >= rankedJobs.length}>Next</Button>
            </div>
          </div>
        </div>
        <JobDetailsPanel job={selectedJob} onApply={applyJob} onResumeLab={openResumeLab} />
      </div>
    </div>
  );
}

function JobDetailsPanel({
  job,
  onApply,
  onResumeLab,
}: {
  job: Job | null;
  onApply: (job: Job) => void;
  onResumeLab: (job: Job) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const canEmbedPreview = job?.job_url ? canEmbedJobUrl(job.job_url) : false;

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
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{job.source}</Badge>
          <Badge variant={job.visa_score === "High" ? "success" : job.visa_score === "Low" ? "destructive" : "warning"}>{job.visa_score}</Badge>
          <Badge variant="outline">{job.work_mode}</Badge>
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
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fit score</span><strong className="text-right font-medium">{job.fit_score}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Trust</span><strong className="text-right font-medium">{job.trust_status}</strong></div>
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
  if (isUnitedStates(location)) return 44_000;
  return 30_000;
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
    "oklahoma",
    " ok",
    ",ok",
    "arkansas",
    " ar",
    ",ar",
    "louisiana",
    " la",
    ",la",
    "new mexico",
    " nm",
    ",nm",
  ].some((token) => location.includes(token));
}

function isUnitedStates(location: string) {
  return location.includes("united states") || /\b[A-Z]{2}\b/i.test(location);
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
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
