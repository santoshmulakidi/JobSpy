"use client";

import { CheckCircle2, Circle, Loader2, Play, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { collectJobs } from "@/lib/api";
import { compactLocation, defaultProfiles, loadProfiles, type JobProfile } from "@/lib/job-profiles";
import type { CollectResult } from "@/types/job";

const LOCATIONS = [
  { value: "remote", label: "🌐 Remote (USA)",        location: "United States",  isRemote: true  },
  { value: "dfw",    label: "🏙️ DFW / Dallas, TX",   location: "Dallas, TX",     isRemote: false },
  { value: "texas",  label: "⭐ Texas (statewide)",   location: "Texas",          isRemote: false },
  { value: "nc",     label: "North Carolina",          location: "North Carolina", isRemote: false },
  { value: "ok",     label: "Oklahoma",                location: "Oklahoma",       isRemote: false },
  { value: "la",     label: "Louisiana",               location: "Louisiana",      isRemote: false },
  { value: "ar",     label: "Arkansas",                location: "Arkansas",       isRemote: false },
  { value: "nm",     label: "New Mexico",              location: "New Mexico",     isRemote: false },
  { value: "va",     label: "Virginia",                location: "Virginia",       isRemote: false },
  { value: "sc",     label: "South Carolina",          location: "South Carolina", isRemote: false },
  { value: "ga",     label: "Georgia",                 location: "Georgia",        isRemote: false },
  { value: "tn",     label: "Tennessee",               location: "Tennessee",      isRemote: false },
  { value: "usa",    label: "🇺🇸 United States (all)", location: "United States",  isRemote: false },
];

const sources = [
  { id: "linkedin",         label: "LinkedIn",                       group: "Core"         },
  { id: "indeed",           label: "Indeed",                         group: "Core"         },
  { id: "google",           label: "Google Jobs",                    group: "Core"         },
  { id: "career_page",      label: "Career Pages",                   group: "Company"      },
  { id: "jobright_h1b",     label: "Jobright H1B",                   group: "Visa"         },
  { id: "dice",             label: "Dice",                           group: "Tech"         },
  { id: "governmentjobs",   label: "GovernmentJobs",                 group: "Public"       },
  { id: "usajobs_api",      label: "USAJOBS (API key required)",     group: "Public",      setupRequired: true },
  { id: "jobspresso",       label: "Jobspresso",                     group: "Remote"       },
  { id: "dynamitejobs",     label: "Dynamite Jobs",                  group: "Remote"       },
  { id: "skipthedrive",     label: "SkipTheDrive",                   group: "Remote"       },
  { id: "remotive",         label: "Remotive",                       group: "Remote"       },
  { id: "remotely",         label: "Remotely.jobs",                  group: "Remote"       },
  { id: "yc_jobs",          label: "YC Jobs",                        group: "Startup"      },
  { id: "simplify_new_grad",label: "Simplify New Grad",              group: "Early career" },
  { id: "github_internships",label: "GitHub Internships",            group: "Early career" },
];

const defaultSources = ["linkedin", "google", "jobright_h1b", "dice", "remotive"];
const selectableSourceIds = sources.filter((s) => !s.setupRequired).map((s) => s.id);

type KeywordStatus = "pending" | "running" | "done" | "error";
interface KeywordRun {
  keyword: string;
  status: KeywordStatus;
  added: number;
  seen: number;
  error?: string;
}

export function CollectForm() {
  const [profiles, setProfiles] = useState<JobProfile[]>(defaultProfiles);
  const [profileId, setProfileId] = useState("dotnet");
  const [customKeyword, setCustomKeyword] = useState("");
  const [locationKey, setLocationKey] = useState("usa");
  const [resultsWanted, setResultsWanted] = useState(1000);
  const [hoursOld, setHoursOld] = useState("24");
  const [remoteMode, setRemoteMode] = useState("false");
  const [jobType, setJobType] = useState("all");
  const [useTargets, setUseTargets] = useState(false);
  const [visaFriendly, setVisaFriendly] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>(defaultSources);
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<KeywordRun[]>([]);
  const abortRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Warn before navigating away mid-collection
  useEffect(() => {
    if (!loading) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [loading]);

  useEffect(() => { setProfiles(loadProfiles()); }, []);

  const activeProfile = profiles.find((p) => p.id === profileId);
  const keywords: string[] = customKeyword.trim()
    ? [customKeyword.trim()]
    : (activeProfile?.preferredTitles ?? []);

  const groupedSources = useMemo(() =>
    sources.reduce<Record<string, typeof sources>>((acc, s) => {
      acc[s.group] = [...(acc[s.group] ?? []), s];
      return acc;
    }, {}), []);

  function toggleSource(id: string) {
    setSelectedSources((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  async function submitCollect() {
    if (!selectedSources.length) { toast.error("Select at least one source"); return; }
    if (!keywords.length) { toast.error("No keywords to search"); return; }

    const locDef = LOCATIONS.find((l) => l.value === locationKey);
    const resolvedLocation = locDef?.location ?? "United States";
    const resolvedRemote = locDef?.isRemote ?? remoteMode === "true";
    const safeResults = Number.isFinite(resultsWanted) ? Math.min(5000, Math.max(1, resultsWanted)) : 1000;

    abortRef.current = false;
    const initial: KeywordRun[] = keywords.map((kw) => ({ keyword: kw, status: "pending", added: 0, seen: 0 }));
    setRuns(initial);
    setLoading(true);

    let totalAdded = 0;
    let totalSeen = 0;

    for (let i = 0; i < keywords.length; i++) {
      if (abortRef.current) break;
      const kw = keywords[i] ?? "";
      if (mountedRef.current) setRuns((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "running" } : r));
      try {
        const res: CollectResult = await collectJobs({
          search_term: kw,
          location: resolvedLocation,
          sites: selectedSources,
          results_wanted: safeResults,
          country_indeed: "usa",
          is_remote: resolvedRemote,
          job_type: jobType === "all" ? null : jobType,
          hours_old: hoursOld === "all" ? null : Number(hoursOld),
          use_company_targets: useTargets,
          visa_friendly_only: visaFriendly,
          skip_expand: true,
        });
        totalAdded += res.jobs_added;
        totalSeen += res.jobs_seen;
        if (mountedRef.current) setRuns((prev) => prev.map((r, idx) =>
          idx === i ? { ...r, status: "done", added: res.jobs_added, seen: res.jobs_seen } : r
        ));
      } catch (err) {
        if (mountedRef.current) {
          const msg = err instanceof Error ? err.message : "Failed";
          setRuns((prev) => prev.map((r, idx) =>
            idx === i ? { ...r, status: "error", error: msg } : r
          ));
        }
      }
    }

    if (mountedRef.current) {
      setLoading(false);
      toast.success(`All done: ${totalAdded} new jobs from ${totalSeen} seen`);
    }
  }

  function stopCollect() {
    abortRef.current = true;
    setLoading(false);
    setRuns((prev) => prev.map((r) => r.status === "pending" ? { ...r, status: "error", error: "Stopped" } : r));
    toast.info("Collection stopped");
  }

  const totalAdded = runs.reduce((s, r) => s + r.added, 0);
  const totalSeen  = runs.reduce((s, r) => s + r.seen, 0);
  const doneCount  = runs.filter((r) => r.status === "done" || r.status === "error").length;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card className="surface shadow-none">
        <CardHeader>
          <CardTitle>Start collection</CardTitle>
          <CardDescription>Pull fresh jobs into the 24-hour active feed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">

            {/* Profile */}
            <label className="space-y-2 text-sm font-medium">
              Profile
              <Select
                value={profileId}
                onValueChange={(val) => {
                  setProfileId(val);
                  setCustomKeyword("");
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            {/* Location */}
            <label className="space-y-2 text-sm font-medium">
              Location
              <Select
                value={locationKey}
                onValueChange={(key) => {
                  setLocationKey(key);
                  const def = LOCATIONS.find((l) => l.value === key);
                  if (def) setRemoteMode(def.isRemote ? "true" : "false");
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOCATIONS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            {/* Keywords */}
            <div className="space-y-2 text-sm font-medium md:col-span-2">
              Search keywords
              <p className="text-xs font-normal text-muted-foreground mb-2">
                {customKeyword.trim()
                  ? "Custom keyword — profile keywords disabled"
                  : `${keywords.length} keywords from ${activeProfile?.name ?? "profile"} — each runs as a separate search`}
              </p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(activeProfile?.preferredTitles ?? []).map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => setCustomKeyword((prev) => prev === kw ? "" : kw)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      customKeyword === kw
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted/40 hover:bg-muted"
                    }`}
                  >
                    {kw}
                  </button>
                ))}
              </div>
              <Input
                value={customKeyword}
                onChange={(e) => setCustomKeyword(e.target.value)}
                placeholder="Type a custom keyword to override profile (or leave blank to run all)"
              />
            </div>

            {/* Results wanted */}
            <label className="space-y-2 text-sm font-medium">
              Results wanted <span className="font-normal text-muted-foreground">(per keyword)</span>
              <div className="flex gap-2">
                <Input min={1} max={5000} type="number" value={resultsWanted} onChange={(e) => setResultsWanted(Number(e.target.value))} />
                <Button variant="outline" type="button" onClick={() => setResultsWanted(5000)}>All</Button>
              </div>
            </label>

            {/* Freshness */}
            <label className="space-y-2 text-sm font-medium">
              Freshness
              <Select value={hoursOld} onValueChange={setHoursOld}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">Last 30 minutes</SelectItem>
                  <SelectItem value="1">Last 1 hour</SelectItem>
                  <SelectItem value="2">Last 2 hours</SelectItem>
                  <SelectItem value="24">Last 24 hours</SelectItem>
                  <SelectItem value="168">Last 7 days</SelectItem>
                  <SelectItem value="all">Any time</SelectItem>
                </SelectContent>
              </Select>
            </label>

            {/* Work mode */}
            <label className="space-y-2 text-sm font-medium">
              Work mode
              <Select value={remoteMode} onValueChange={setRemoteMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">All work modes</SelectItem>
                  <SelectItem value="true">Remote only</SelectItem>
                </SelectContent>
              </Select>
            </label>

            {/* Job type */}
            <label className="space-y-2 text-sm font-medium">
              Job type
              <Select value={jobType} onValueChange={setJobType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All job types</SelectItem>
                  <SelectItem value="fulltime">Full-time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="w2">W2</SelectItem>
                  <SelectItem value="c2c">C2C</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          {/* Source toggles */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" type="button" onClick={() => setSelectedSources(selectableSourceIds)}>Select all ready sources</Button>
            <Button variant="outline" type="button" onClick={() => setSelectedSources([])}>Deselect all</Button>
            <Button variant="outline" type="button" onClick={() => setSelectedSources(defaultSources)}>
              <RotateCcw className="h-4 w-4" /> Recommended
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(groupedSources).map(([group, gs]) => (
              <fieldset key={group} className="rounded-xl border p-4">
                <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</legend>
                <div className="mt-2 grid gap-2">
                  {gs.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input className="h-4 w-4 accent-primary" type="checkbox"
                        checked={selectedSources.includes(s.id)}
                        onChange={() => toggleSource(s.id)} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl border p-3 text-sm">
              <input className="h-4 w-4 accent-primary" type="checkbox" checked={useTargets} onChange={(e) => setUseTargets(e.target.checked)} />
              Use company targets
            </label>
            <label className="flex items-center gap-2 rounded-xl border p-3 text-sm">
              <input className="h-4 w-4 accent-primary" type="checkbox" checked={visaFriendly} onChange={(e) => setVisaFriendly(e.target.checked)} />
              Visa-friendly mode
            </label>
          </div>

          <div className="flex gap-3">
            <Button size="lg" onClick={submitCollect} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading
                ? `Searching ${doneCount}/${keywords.length} keywords…`
                : `Start collection (${keywords.length} keyword${keywords.length !== 1 ? "s" : ""})`}
            </Button>
            {loading && (
              <Button size="lg" variant="destructive" onClick={stopCollect}>
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Status panel */}
      <Card className="surface h-fit shadow-none">
        <CardHeader>
          <CardTitle>Collection status</CardTitle>
          <CardDescription>
            {runs.length > 0
              ? `${doneCount} / ${runs.length} keywords done · ${totalAdded} new jobs`
              : "Latest run summary"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {runs.length === 0 ? (
            <p className="text-muted-foreground">No collection run started yet.</p>
          ) : (
            <>
              {runs.map((r) => (
                <div key={r.keyword} className="flex items-center gap-2">
                  {r.status === "pending" && <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  {r.status === "running" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
                  {r.status === "done"    && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />}
                  {r.status === "error"   && <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                  <span className={`flex-1 truncate ${r.status === "pending" ? "text-muted-foreground" : ""}`}>
                    {r.keyword}
                  </span>
                  {r.status === "done" && (
                    <span className="shrink-0 text-xs text-muted-foreground">+{r.added}</span>
                  )}
                  {r.status === "error" && (
                    <span className="shrink-0 text-xs text-destructive" title={r.error}>err</span>
                  )}
                </div>
              ))}
              {doneCount === runs.length && runs.length > 0 && (
                <div className="mt-3 rounded-lg border p-3 text-xs space-y-1">
                  <div className="flex justify-between"><span>Total seen</span><strong>{totalSeen}</strong></div>
                  <div className="flex justify-between"><span>New jobs added</span><strong>{totalAdded}</strong></div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
