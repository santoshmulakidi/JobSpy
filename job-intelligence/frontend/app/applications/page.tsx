"use client";

import { useEffect, useState } from "react";

import { ExternalLink } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getApplications, updateApplicationStage } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { Application } from "@/types/job";

const STAGES = [
  "Saved",
  "Applied",
  "Phone Screen",
  "Technical Interview",
  "Onsite Interview",
  "Offer",
];
const TERMINAL_STAGES = ["Accepted", "Rejected", "Withdrawn"];

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<number | null>(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    getApplications()
      .then(setApplications)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load applications"))
      .finally(() => setLoading(false));
  }

  async function moveStage(app: Application, newStatus: string) {
    setMoving(app.id);
    try {
      await updateApplicationStage(app.id, newStatus);
      setApplications((prev) =>
        prev.map((a) => (a.id === app.id ? { ...a, status: newStatus } : a)),
      );
    } finally {
      setMoving(null);
    }
  }

  const byStage = (stage: string) => applications.filter((a) => a.status === stage);
  const terminals = applications.filter((a) => TERMINAL_STAGES.includes(a.status));

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Applications</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Pipeline</h1>
        </div>
        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        ) : null}
        {loading ? (
          <div className="flex gap-4">
            {STAGES.map((s) => <Skeleton key={s} className="h-64 w-56 rounded-xl shrink-0" />)}
          </div>
        ) : (
          <>
            <div className="flex gap-3 overflow-x-auto pb-4">
              {STAGES.map((stage) => (
                <div key={stage} className="w-56 shrink-0">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-medium">{stage}</span>
                    <Badge variant="secondary" className="text-xs">{byStage(stage).length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {byStage(stage).map((app) => (
                      <KanbanCard
                        key={app.id}
                        app={app}
                        stages={STAGES}
                        terminalStages={TERMINAL_STAGES}
                        moving={moving === app.id}
                        onMove={(s) => moveStage(app, s)}
                      />
                    ))}
                    {byStage(stage).length === 0 && (
                      <div className="rounded-lg border border-dashed border-border/50 p-4 text-center text-xs text-muted-foreground">
                        Empty
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {terminals.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">Closed</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {terminals.map((app) => (
                    <KanbanCard
                      key={app.id}
                      app={app}
                      stages={STAGES}
                      terminalStages={TERMINAL_STAGES}
                      moving={moving === app.id}
                      onMove={(s) => moveStage(app, s)}
                    />
                  ))}
                </div>
              </div>
            )}

            {applications.length === 0 && (
              <Card className="surface shadow-none">
                <CardHeader><CardTitle>No applications yet</CardTitle></CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Mark jobs as applied from the Jobs page to track them here.
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function KanbanCard({
  app,
  stages,
  terminalStages,
  moving,
  onMove,
}: {
  app: Application;
  stages: string[];
  terminalStages: string[];
  moving: boolean;
  onMove: (status: string) => void;
}) {
  const allStages = [...stages, ...terminalStages];
  const currentIndex = allStages.indexOf(app.status);
  const nextStage = currentIndex < stages.length - 1 ? stages[currentIndex + 1] : null;
  const job = app.job;

  const stageColor: Record<string, string> = {
    Offer: "success",
    Accepted: "success",
    Rejected: "destructive",
    Withdrawn: "secondary",
  };

  return (
    <Card className="surface shadow-none text-sm">
      <CardContent className="p-3 space-y-2">
        <div className="font-medium leading-tight line-clamp-2">{job.title}</div>
        <div className="text-xs text-muted-foreground">{job.company_name ?? "Unknown"}</div>
        {job.salary_display && (
          <div className="text-xs text-muted-foreground">{job.salary_display}</div>
        )}
        <div className="flex items-center justify-between gap-1">
          <Badge
            variant={(stageColor[app.status] as "success" | "destructive" | "secondary") ?? "outline"}
            className="text-[10px]"
          >
            {app.status}
          </Badge>
          <span className="text-[10px] text-muted-foreground">{formatDate(app.applied_at)}</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {nextStage && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2"
              disabled={moving}
              onClick={() => onMove(nextStage)}
            >
              → {nextStage}
            </Button>
          )}
          {!terminalStages.includes(app.status) && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
                disabled={moving}
                onClick={() => onMove("Rejected")}
              >
                Rejected
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2"
                disabled={moving}
                onClick={() => onMove("Withdrawn")}
              >
                Withdraw
              </Button>
            </>
          )}
          {job.job_url && (
            <Button asChild variant="ghost" size="sm" className="h-6 w-6 px-0">
              <a href={job.job_url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
