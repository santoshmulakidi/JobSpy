"use client";

import { useEffect, useState } from "react";

import { Activity, ChevronDown, ChevronRight, Clock, Database, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type RunStat = {
  id: number;
  search_term: string;
  location: string | null;
  jobs_seen: number;
  error_count: number;
  started_at: string | null;
  duration_s: number | null;
};

type SchedulerStats = {
  active_jobs: number;
  archived_jobs: number;
  new_this_week: number;
  retention_days: number;
  sources: { source: string; count: number }[];
  recent_runs: RunStat[];
};

const API_BASE = process.env.NEXT_PUBLIC_JOB_API_URL ?? "http://127.0.0.1:8000";

const SETUP = {
  interval: "Every 1 hour",
  keywords: [
    ".NET Developer",
    "DotNet Developer",
    "C# Developer",
    "ASP.NET Core Developer",
    "Azure Developer .NET",
    ".NET Solutions Architect",
    "Azure Application Architect",
    "Principal .NET Engineer",
    "Staff Software Engineer C#",
  ],
  locationSearches: "9 keywords × USA-wide (LinkedIn, Indeed, Google, Career Page, JobRight H1B, Dice)",
  remoteBoardSearches: '3 broad keywords × Remote boards (Jobspresso, DynamiteJobs, Remotive, Remotely, YC Jobs…)',
  totalPerRun: "12 searches, 4 parallel workers",
  retention: "7 days — auto-archived after last seen",
};

async function fetchStats(): Promise<SchedulerStats> {
  const res = await fetch(`${API_BASE}/scheduler/run-stats`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load stats");
  return res.json();
}

function toCst(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const formatted = d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  // Show CDT in summer (Mar–Nov), CST in winter
  const month = d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric" });
  const m = parseInt(month);
  const tz = m >= 3 && m <= 11 ? "CDT" : "CST";
  return `${formatted} ${tz}`;
}

function duration(s: number | null) {
  if (s === null) return "—";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function SchedulerStatus() {
  const [stats, setStats] = useState<SchedulerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runsOpen, setRunsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setStats(await fetchStats());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function triggerNow() {
    setTriggering(true);
    try {
      const res = await fetch(`${API_BASE}/scheduler/trigger`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(data.message ?? "Collection triggered");
      // Refresh stats after a short delay
      setTimeout(load, 3000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Trigger failed");
    } finally {
      setTriggering(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <Card className="surface shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" /> Auto-run status
        </CardTitle>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={triggerNow} disabled={triggering || loading}>
            <Play className={`h-3 w-3 ${triggering ? "animate-pulse" : ""}`} />
            {triggering ? "Running…" : "Run now"}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !stats ? (
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : stats ? (
          <>
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border bg-background/60 p-3 text-center">
                <div className="text-lg font-semibold">{stats.active_jobs.toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">Active jobs</div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3 text-center">
                <div className="text-lg font-semibold text-primary">{stats.new_this_week.toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">Added this week</div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3 text-center">
                <div className="text-lg font-semibold text-muted-foreground">{stats.archived_jobs.toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">Archived</div>
              </div>
            </div>

            {/* Retention notice */}
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span>Jobs kept for <strong>7 days</strong> from last seen. Auto-run <strong>every 1 hour</strong> · <strong>12 searches</strong> per run · <strong>4 parallel workers</strong>.</span>
            </div>

            {/* Source breakdown */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Active by source</p>
              <div className="flex flex-wrap gap-1.5">
                {stats.sources.map((s) => (
                  <Badge key={s.source} variant="secondary" className="text-[11px]">
                    {s.source} · {s.count.toLocaleString()}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Search setup — collapsible */}
            <div className="rounded-lg border border-border/60">
              <button
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium"
                onClick={() => setSetupOpen((o) => !o)}
              >
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" /> Search setup &amp; keywords
                </span>
                {setupOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              {setupOpen && (
                <div className="border-t border-border/60 px-3 py-2.5 space-y-2 text-xs text-muted-foreground">
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <span className="font-medium text-foreground">Interval</span>
                    <span>{SETUP.interval} (CST)</span>
                    <span className="font-medium text-foreground">Per run</span>
                    <span>{SETUP.totalPerRun}</span>
                    <span className="font-medium text-foreground">Location</span>
                    <span>{SETUP.locationSearches}</span>
                    <span className="font-medium text-foreground">Remote</span>
                    <span>{SETUP.remoteBoardSearches}</span>
                    <span className="font-medium text-foreground">Retention</span>
                    <span>{SETUP.retention}</span>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Keywords ({SETUP.keywords.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {SETUP.keywords.map((kw) => (
                        <Badge key={kw} variant="outline" className="text-[10px] font-normal">{kw}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Recent runs — collapsible, hidden by default */}
            <div className="rounded-lg border border-border/60">
              <button
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium"
                onClick={() => setRunsOpen((o) => !o)}
              >
                <span className="flex items-center gap-1.5">
                  <Database className="h-3 w-3 text-muted-foreground" /> Last 10 collect runs
                  {stats.recent_runs.length > 0 && (
                    <span className="text-muted-foreground font-normal">
                      · latest {toCst(stats.recent_runs[0]?.started_at ?? null)}
                    </span>
                  )}
                </span>
                {runsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              {runsOpen && (
                <div className="border-t border-border/60 px-3 py-2 space-y-1 text-xs">
                  {stats.recent_runs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 rounded border border-border/50 bg-background/40 px-2.5 py-1.5">
                      <div className="min-w-0 flex-1 truncate font-medium" title={r.search_term}>{r.search_term}</div>
                      <div className="shrink-0 text-muted-foreground">{r.location ?? "—"}</div>
                      <div className="shrink-0 font-semibold text-primary">{r.jobs_seen.toLocaleString()}</div>
                      {r.error_count > 0 && <Badge variant="destructive" className="text-[10px] px-1">{r.error_count} err</Badge>}
                      <div className="shrink-0 text-muted-foreground">{duration(r.duration_s)}</div>
                      <div className="shrink-0 text-muted-foreground">{toCst(r.started_at)}</div>
                    </div>
                  ))}
                  {stats.recent_runs.length === 0 && (
                    <p className="text-muted-foreground py-2 text-center">No runs yet.</p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
