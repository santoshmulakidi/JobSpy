"use client";

import { Loader2, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { collectJobs } from "@/lib/api";
import { compactLocation, defaultProfiles, expandSearchTerm, loadProfiles, type JobProfile } from "@/lib/job-profiles";
import type { CollectResult } from "@/types/job";

const DOTNET_KEYWORDS = [
  "Senior .NET Developer",
  "Senior Full Stack .NET Developer",
  "Senior C# Developer",
  "Senior Azure Developer",
  "Senior Software Engineer .NET",
  ".NET Cloud Developer",
  "Senior ASP.NET Core Developer",
  "Senior Backend Developer C#",
  ".NET Solutions Architect",
  "Azure Application Architect",
  "Principal .NET Developer",
  "Lead .NET Developer",
];

const LOCATIONS = [
  { value: "remote", label: "Remote (USA)", location: "United States", isRemote: true },
  { value: "dfw", label: "DFW / Dallas, TX", location: "Dallas, TX", isRemote: false },
  { value: "texas", label: "Texas (statewide)", location: "Texas", isRemote: false },
  { value: "nc", label: "North Carolina", location: "North Carolina", isRemote: false },
  { value: "ok", label: "Oklahoma", location: "Oklahoma", isRemote: false },
  { value: "la", label: "Louisiana", location: "Louisiana", isRemote: false },
  { value: "ar", label: "Arkansas", location: "Arkansas", isRemote: false },
  { value: "nm", label: "New Mexico", location: "New Mexico", isRemote: false },
  { value: "va", label: "Virginia", location: "Virginia", isRemote: false },
  { value: "sc", label: "South Carolina", location: "South Carolina", isRemote: false },
  { value: "ga", label: "Georgia", location: "Georgia", isRemote: false },
  { value: "tn", label: "Tennessee", location: "Tennessee", isRemote: false },
  { value: "usa", label: "United States (all)", location: "United States", isRemote: false },
];

const sources = [
  { id: "linkedin", label: "LinkedIn", group: "Core" },
  { id: "indeed", label: "Indeed", group: "Core" },
  { id: "google", label: "Google Jobs", group: "Core" },
  { id: "career_page", label: "Career Pages", group: "Company" },
  { id: "jobright_h1b", label: "Jobright H1B", group: "Visa" },
  { id: "dice", label: "Dice", group: "Tech" },
  { id: "governmentjobs", label: "GovernmentJobs", group: "Public" },
  { id: "usajobs_api", label: "USAJOBS (API key required)", group: "Public", setupRequired: true },
  { id: "jobspresso", label: "Jobspresso", group: "Remote" },
  { id: "dynamitejobs", label: "Dynamite Jobs", group: "Remote" },
  { id: "skipthedrive", label: "SkipTheDrive", group: "Remote" },
  { id: "remotive", label: "Remotive", group: "Remote" },
  { id: "remotely", label: "Remotely.jobs", group: "Remote" },
  { id: "yc_jobs", label: "YC Jobs", group: "Startup" },
  { id: "simplify_new_grad", label: "Simplify New Grad", group: "Early career" },
  { id: "github_internships", label: "GitHub Internships", group: "Early career" },
];

const defaultSources = ["linkedin", "google", "jobright_h1b", "dice", "remotive"];
const selectableSourceIds = sources.filter((source) => !source.setupRequired).map((source) => source.id);

export function CollectForm() {
  const [profiles, setProfiles] = useState<JobProfile[]>(defaultProfiles);
  const [profileId, setProfileId] = useState("dotnet");
  const [searchTerm, setSearchTerm] = useState(".NET developer or Java developer");
  const [location, setLocation] = useState("United States");
  const [locationKey, setLocationKey] = useState("usa");
  const [resultsWanted, setResultsWanted] = useState(1000);
  const [hoursOld, setHoursOld] = useState("24");
  const [remoteMode, setRemoteMode] = useState("false");
  const [jobType, setJobType] = useState("all");
  const [useTargets, setUseTargets] = useState(false);
  const [visaFriendly, setVisaFriendly] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>(defaultSources);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CollectResult | null>(null);

  useEffect(() => {
    setProfiles(loadProfiles());
  }, []);

  const groupedSources = useMemo(() => {
    return sources.reduce<Record<string, typeof sources>>((groups, source) => {
      groups[source.group] = [...(groups[source.group] ?? []), source];
      return groups;
    }, {});
  }, []);

  function toggleSource(sourceId: string) {
    setSelectedSources((current) => (
      current.includes(sourceId) ? current.filter((item) => item !== sourceId) : [...current, sourceId]
    ));
  }

  async function submitCollect() {
    if (!selectedSources.length) {
      toast.error("Select at least one source");
      return;
    }
    const safeResultsWanted = Number.isFinite(resultsWanted)
      ? Math.min(5000, Math.max(1, resultsWanted))
      : 1000;
    setLoading(true);
    setResult(null);
    try {
      const locDef = LOCATIONS.find((l) => l.value === locationKey);
      const resolvedLocation = locDef ? locDef.location : location.trim() || null;
      const resolvedRemote = locDef ? locDef.isRemote : remoteMode === "true";
      const response = await collectJobs({
        search_term: expandSearchTerm(searchTerm),
        location: resolvedLocation,
        sites: selectedSources,
        results_wanted: safeResultsWanted,
        country_indeed: "usa",
        is_remote: resolvedRemote,
        job_type: jobType === "all" ? null : jobType,
        hours_old: hoursOld === "all" ? null : Number(hoursOld),
        use_company_targets: useTargets,
        visa_friendly_only: visaFriendly,
      });
      setResult(response);
      toast.success(`Collection finished: ${response.jobs_added} new jobs`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Collection failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card className="surface shadow-none">
        <CardHeader>
          <CardTitle>Start collection</CardTitle>
          <CardDescription>Pull fresh jobs into the 24-hour active feed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm font-medium">
              Profile
              <Select
                value={profileId}
                onValueChange={(value) => {
                  setProfileId(value);
                  const profile = profiles.find((item) => item.id === value);
                  if (profile) {
                    setSearchTerm(profile.searchTerm);
                    setLocation(compactLocation(profile));
                  }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="space-y-2 text-sm font-medium">
              Search keywords
              <div className="flex flex-wrap gap-1.5 mb-2">
                {DOTNET_KEYWORDS.map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => setSearchTerm(kw)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      searchTerm === kw
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted/40 hover:bg-muted"
                    }`}
                  >
                    {kw}
                  </button>
                ))}
              </div>
              <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Or type a custom keyword" />
            </div>
            <label className="space-y-2 text-sm font-medium">
              Location
              <Select
                value={locationKey}
                onValueChange={(key) => {
                  setLocationKey(key);
                  const def = LOCATIONS.find((l) => l.value === key);
                  if (def) {
                    setLocation(def.location);
                    setRemoteMode(def.isRemote ? "true" : "false");
                  }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="remote">🌐 Remote (USA)</SelectItem>
                  <SelectItem value="dfw">🏙️ DFW / Dallas, TX</SelectItem>
                  <SelectItem value="texas">⭐ Texas (statewide)</SelectItem>
                  <SelectItem value="nc">North Carolina</SelectItem>
                  <SelectItem value="ok">Oklahoma</SelectItem>
                  <SelectItem value="la">Louisiana</SelectItem>
                  <SelectItem value="ar">Arkansas</SelectItem>
                  <SelectItem value="nm">New Mexico</SelectItem>
                  <SelectItem value="va">Virginia</SelectItem>
                  <SelectItem value="sc">South Carolina</SelectItem>
                  <SelectItem value="ga">Georgia</SelectItem>
                  <SelectItem value="tn">Tennessee</SelectItem>
                  <SelectItem value="usa">🇺🇸 United States (all)</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              Results wanted
              <div className="flex gap-2">
                <Input min={1} max={5000} type="number" value={resultsWanted} onChange={(event) => setResultsWanted(Number(event.target.value))} />
                <Button variant="outline" type="button" onClick={() => setResultsWanted(5000)}>All</Button>
              </div>
              <span className="block text-xs font-normal text-muted-foreground">Use All to pull the maximum available per run, then dedupe against stored jobs.</span>
            </label>
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

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" type="button" onClick={() => setSelectedSources(selectableSourceIds)}>Select all ready sources</Button>
            <Button variant="outline" type="button" onClick={() => setSelectedSources([])}>Deselect all</Button>
            <Button variant="outline" type="button" onClick={() => setSelectedSources(defaultSources)}>
              <RotateCcw className="h-4 w-4" /> Recommended
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(groupedSources).map(([group, groupSources]) => (
              <fieldset key={group} className="rounded-xl border p-4">
                <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</legend>
                <div className="mt-2 grid gap-2">
                  {groupSources.map((source) => (
                    <label key={source.id} className="flex items-center gap-2 text-sm">
                      <input
                        className="h-4 w-4 accent-primary"
                        type="checkbox"
                        checked={selectedSources.includes(source.id)}
                        onChange={() => toggleSource(source.id)}
                      />
                      {source.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl border p-3 text-sm">
              <input className="h-4 w-4 accent-primary" type="checkbox" checked={useTargets} onChange={(event) => setUseTargets(event.target.checked)} />
              Use company targets
            </label>
            <label className="flex items-center gap-2 rounded-xl border p-3 text-sm">
              <input className="h-4 w-4 accent-primary" type="checkbox" checked={visaFriendly} onChange={(event) => setVisaFriendly(event.target.checked)} />
              Visa-friendly mode
            </label>
          </div>

          <Button size="lg" onClick={submitCollect} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {loading ? "Collecting" : "Start collection"}
          </Button>
        </CardContent>
      </Card>

      <Card className="surface h-fit shadow-none">
        <CardHeader>
          <CardTitle>Collection status</CardTitle>
          <CardDescription>Latest run summary</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {result ? (
            <>
              <div className="flex justify-between"><span>Search run</span><strong>{result.search_run_id}</strong></div>
              <div className="flex justify-between"><span>Jobs seen</span><strong>{result.jobs_seen}</strong></div>
              <div className="flex justify-between"><span>New jobs added</span><strong>{result.jobs_added}</strong></div>
              <div className="flex justify-between"><span>Warnings</span><strong>{(result.warnings ?? []).length}</strong></div>
              {(result.warnings ?? []).length ? <pre className="max-h-52 overflow-auto rounded-lg bg-warning/10 p-3 text-xs text-warning-foreground">{(result.warnings ?? []).join("\n")}</pre> : null}
              <div className="flex justify-between"><span>Errors</span><strong>{result.errors.length}</strong></div>
              {result.errors.length ? <pre className="max-h-52 overflow-auto rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{result.errors.join("\n")}</pre> : null}
            </>
          ) : (
            <p className="text-muted-foreground">No collection run started from this page yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
