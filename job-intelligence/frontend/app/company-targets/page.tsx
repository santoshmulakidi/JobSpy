"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCompanyTargets } from "@/lib/api";
import type { CompanyTarget } from "@/types/job";

export default function CompanyTargetsPage() {
  const [targets, setTargets] = useState<CompanyTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCompanyTargets(500)
      .then(setTargets)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load company targets"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Company targets</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Visa-aware company list</h1>
        </div>
        {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}
        {loading ? <Skeleton className="h-96 rounded-xl" /> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {targets.map((target) => (
              <Card key={`${target.rank}-${target.company}`} className="surface shadow-none">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>{target.company}</CardTitle>
                    <Badge variant={target.sponsor_status?.toLowerCase().includes("strong") ? "success" : "secondary"}>#{target.rank}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>{target.sector ?? "Sector not listed"}</p>
                  <p>{target.sponsor_status ?? "Sponsor status not listed"}</p>
                  <p>{target.h1b_or_funding ?? "H1B/funding data not listed"}</p>
                  {target.career_url ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={target.career_url} target="_blank" rel="noreferrer">Careers <ExternalLink className="h-3.5 w-3.5" /></a>
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
