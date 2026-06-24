"use client";

import { Building2, Play, RefreshCw, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getH1BCompanySchedulerStatus,
  startH1BCompanyScheduler,
  stopH1BCompanyScheduler,
  triggerH1BCompanyScheduler,
} from "@/lib/api";
import type { SchedulerStatus } from "@/types/job";

function toCdt(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function H1BCompanyScheduler() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setStatus(await getH1BCompanySchedulerStatus());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load H1B schedule");
    } finally {
      setLoading(false);
    }
  }

  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <Card className="surface shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" /> H1B company schedule
        </CardTitle>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={busy} onClick={() => action(triggerH1BCompanyScheduler, "H1B company run triggered")}>
            <Play className="h-3 w-3" /> Run now
          </Button>
          {status?.running ? (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={busy} onClick={() => action(stopH1BCompanyScheduler, "H1B schedule stopped")}>
              <Square className="h-3 w-3" /> Stop
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={busy} onClick={() => action(startH1BCompanyScheduler, "H1B schedule started")}>
              <Play className="h-3 w-3" /> Start
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={loading} onClick={load}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !status ? (
          <Skeleton className="h-32 rounded-lg" />
        ) : status ? (
          <>
            <div className="grid gap-2 md:grid-cols-4">
              <div className="rounded-lg border bg-background/60 p-3">
                <div className="text-lg font-semibold">{status.running ? "Running" : "Stopped"}</div>
                <div className="text-[11px] text-muted-foreground">Status</div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3">
                <div className="text-lg font-semibold">{status.interval_hours}h</div>
                <div className="text-[11px] text-muted-foreground">Interval</div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3">
                <div className="text-lg font-semibold">{(status.target_count ?? 0).toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">Non-LLC targets</div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3">
                <div className="text-lg font-semibold">{(status.last_jobs_seen ?? 0).toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">Last jobs seen</div>
              </div>
            </div>
            <div className="grid gap-2 text-xs md:grid-cols-2">
              <div className="rounded-lg border bg-background/40 p-3">
                <span className="font-medium">Next run</span>
                <span className="ml-2 text-muted-foreground">{toCdt(status.next_run_at)}</span>
              </div>
              <div className="rounded-lg border bg-background/40 p-3">
                <span className="font-medium">Last run</span>
                <span className="ml-2 text-muted-foreground">{toCdt(status.last_run_at)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(status.sources ?? []).map((source) => (
                <Badge key={source} variant="secondary" className="text-[11px]">{source}</Badge>
              ))}
              {(status.last_error_count ?? 0) > 0 && (
                <Badge variant="destructive" className="text-[11px]">{status.last_error_count} errors</Badge>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
