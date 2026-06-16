import { AppShell } from "@/components/layout/app-shell";
import { CollectForm } from "@/components/collect/collect-form";
import { SchedulerStatus } from "@/components/collect/scheduler-status";

export default function CollectPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Collect</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Job collection</h1>
        </div>
        <SchedulerStatus />
        <CollectForm />
      </div>
    </AppShell>
  );
}
