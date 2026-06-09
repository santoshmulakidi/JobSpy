"use client";

import { Loader2, Play, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { collectJobs } from "@/lib/api";
import type { CollectResult } from "@/types/job";

const sources = [
  { id: "linkedin", label: "LinkedIn", group: "Core" },
  { id: "indeed", label: "Indeed", group: "Core" },
  { id: "google", label: "Google Jobs", group: "Core" },
  { id: "career_page", label: "Career Pages", group: "Company" },
  { id: "jobright_h1b", label: "Jobright H1B", group: "Visa" },
  { id: "dice", label: "Dice", group: "Tech" },
  { id: "governmentjobs", label: "GovernmentJobs", group: "Public" },
  { id: "usajobs_api", label: "USAJOBS", group: "Public" },
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

export function CollectForm() {
  const [searchTerm, setSearchTerm] = useState(".NET developer or Java developer");
  const [location, setLocation] = useState("United States");
  const [resultsWanted, setResultsWanted] = useState(100);
  const [hoursOld, setHoursOld] = useState("24");
  const [remoteMode, setRemoteMode] = useState("false");
  const [jobType, setJobType] = useState("fulltime");
  const [useTargets, setUseTargets] = useState(false);
  const [visaFriendly, setVisaFriendly] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>(defaultSources);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CollectResult | null>(null);

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
      ? Math.min(1000, Math.max(1, resultsWanted))
      : 100;
    setLoading(true);
    setResult(null);
    try {
      const response = await collectJobs({
        search_term: searchTerm,
        location: location.trim() || null,
        sites: selectedSources,
        results_wanted: safeResultsWanted,
        country_indeed: "usa",
        is_remote: remoteMode === "true",
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
              Search keywords
              <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
            </label>
            <label className="space-y-2 text-sm font-medium">
              Location
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="United States">United States (all)</SelectItem>
                  <SelectItem value="Remote">Remote (USA)</SelectItem>
                  <SelectItem value="New York, NY">New York, NY</SelectItem>
                  <SelectItem value="San Francisco, CA">San Francisco, CA</SelectItem>
                  <SelectItem value="Seattle, WA">Seattle, WA</SelectItem>
                  <SelectItem value="Austin, TX">Austin, TX</SelectItem>
                  <SelectItem value="Chicago, IL">Chicago, IL</SelectItem>
                  <SelectItem value="Boston, MA">Boston, MA</SelectItem>
                  <SelectItem value="Los Angeles, CA">Los Angeles, CA</SelectItem>
                  <SelectItem value="Dallas, TX">Dallas, TX</SelectItem>
                  <SelectItem value="Atlanta, GA">Atlanta, GA</SelectItem>
                  <SelectItem value="Denver, CO">Denver, CO</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              Results wanted
              <Input min={1} max={1000} type="number" value={resultsWanted} onChange={(event) => setResultsWanted(Number(event.target.value))} />
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
                  <SelectItem value="fulltime">Full-time</SelectItem>
                  <SelectItem value="all">Any type</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" type="button" onClick={() => setSelectedSources(sources.map((source) => source.id))}>Select all sources</Button>
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
              <div className="flex justify-between"><span>Errors</span><strong>{result.errors.length}</strong></div>
              {result.errors.length ? <pre className="max-h-52 overflow-auto rounded-lg bg-muted p-3 text-xs">{result.errors.join("\n")}</pre> : null}
            </>
          ) : (
            <p className="text-muted-foreground">No collection run started from this page yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
