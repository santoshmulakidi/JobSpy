"use client";

import { useEffect, useState } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSourceCounts } from "@/lib/api";
import type { SourceCount } from "@/types/job";

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSourceCounts()
      .then(setSources)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load source counts"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Sources</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Source health</h1>
        </div>
        {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}
        {loading ? <Skeleton className="h-80 rounded-xl" /> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sources.map((source) => (
              <Card key={source.source} className="surface shadow-none">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>{source.source}</CardTitle>
                  <Badge variant="success">active</Badge>
                </CardHeader>
                <CardContent className="text-2xl font-medium">{source.job_count.toLocaleString()} jobs</CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
