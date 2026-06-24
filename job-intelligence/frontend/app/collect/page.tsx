import { AppShell } from "@/components/layout/app-shell";
import { CollectForm } from "@/components/collect/collect-form";
import { H1BCompanyScheduler } from "@/components/collect/h1b-company-scheduler";
import { SchedulerStatus } from "@/components/collect/scheduler-status";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function CollectPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Collect</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Job collection</h1>
        </div>
        <Tabs defaultValue="manual">
          <TabsList>
            <TabsTrigger value="manual">Manual collection</TabsTrigger>
            <TabsTrigger value="h1b">H1B company schedule</TabsTrigger>
          </TabsList>
          <TabsContent value="manual" className="space-y-6">
            <SchedulerStatus />
            <CollectForm />
          </TabsContent>
          <TabsContent value="h1b">
            <H1BCompanyScheduler />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
