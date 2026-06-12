import { AppShell } from "@/components/layout/app-shell";
import { CollectForm } from "@/components/collect/collect-form";

export default function CollectPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Collect</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Job collection control center</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Search fresh roles by keyword, location, source, freshness window, and visa-friendly company targets.
          </p>
        </div>
        <CollectForm />
      </div>
    </AppShell>
  );
}
