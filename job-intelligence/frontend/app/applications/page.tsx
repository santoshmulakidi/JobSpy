"use client";

import { useEffect, useState } from "react";

import { JobTable } from "@/components/dashboard/job-table";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getApplications } from "@/lib/api";
import type { Application } from "@/types/job";

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApplications()
      .then(setApplications)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load applications"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Applications</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Applied jobs saved separately</h1>
        </div>
        {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}
        {loading ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : applications.length ? (
          <JobTable jobs={applications.map((application) => application.job)} />
        ) : (
          <Card className="surface shadow-none">
            <CardHeader><CardTitle>No applications yet</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">Mark jobs as applied from the Jobs page to preserve them here.</CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
