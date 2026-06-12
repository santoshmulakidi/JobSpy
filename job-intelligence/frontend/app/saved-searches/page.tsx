"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteSavedSearch, getSavedSearches } from "@/lib/api";
import type { SavedSearch } from "@/types/job";

export default function SavedSearchesPage() {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSavedSearches()
      .then(setSearches)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load saved searches"))
      .finally(() => setLoading(false));
  }, []);

  async function removeSearch(search: SavedSearch) {
    try {
      await deleteSavedSearch(search.id);
      setSearches((current) => current.filter((item) => item.id !== search.id));
      toast.success("Saved search deleted");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete saved search");
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Saved searches</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Reusable job filters</h1>
        </div>
        {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}
        {loading ? <Skeleton className="h-80 rounded-xl" /> : (
          <div className="grid gap-4">
            {searches.map((search) => (
              <Card key={search.id} className="surface shadow-none">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>{search.name}</CardTitle>
                  <Button variant="ghost" size="icon" onClick={() => removeSearch(search)} aria-label={`Delete ${search.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {Object.entries(search.filters).filter(([, value]) => Boolean(value)).map(([key, value]) => `${key}: ${String(value)}`).join(" | ") || "No filters"}
                </CardContent>
              </Card>
            ))}
            {!searches.length ? <p className="text-sm text-muted-foreground">No saved searches yet.</p> : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
