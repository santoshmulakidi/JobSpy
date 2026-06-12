"use client";

import { Activity, BriefcaseBusiness, Building2, RadioTower } from "lucide-react";
import { useEffect, useState } from "react";

import { ChannelBars } from "@/components/dashboard/channel-bars";
import { JobTable } from "@/components/dashboard/job-table";
import { MetricCard } from "@/components/dashboard/metric-card";
import { QuickInvite } from "@/components/dashboard/quick-invite";
import { Beam } from "@/components/magic/beam";
import { Skeleton } from "@/components/ui/skeleton";
import { getApplications, getJobs, getStats } from "@/lib/api";
import type { Application, Job, Stats } from "@/types/job";

export function DashboardClient() {
  const [stats, setStats] = useState<Stats>({ total_jobs: 0, remote_jobs: 0, companies: 0 });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      getStats().catch(() => ({ total_jobs: 0, remote_jobs: 0, companies: 0 })),
      getJobs(8).catch(() => []),
      getApplications().catch(() => []),
    ]).then(([nextStats, nextJobs, nextApplications]) => {
      if (!active) return;
      setStats(nextStats);
      setJobs(nextJobs);
      setApplications(nextApplications);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="relative space-y-6">
      <Beam />
      <div>
        <p className="text-sm text-muted-foreground">Dashboard</p>
        <h1 className="mt-1 text-3xl font-medium tracking-tight">Today’s job command center</h1>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active jobs" value={stats.total_jobs} trend="Only last 24 hours shown" icon={BriefcaseBusiness} />
        <MetricCard label="Remote roles" value={stats.remote_jobs} trend="Remote feed across sources" icon={RadioTower} tone="success" />
        <MetricCard label="Companies" value={stats.companies} trend="Known company graph" icon={Building2} tone="warning" />
        <MetricCard label="Applied saved" value={applications.length} trend="Preserved application history" icon={Activity} tone="primary" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        {loading ? <Skeleton className="h-[420px] rounded-xl" /> : <JobTable jobs={jobs} />}
        <div className="space-y-4">
          <ChannelBars />
          <QuickInvite />
        </div>
      </div>
    </div>
  );
}
