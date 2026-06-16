"use client";

import { useState } from "react";

import { ArrowUpRight, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatDate } from "@/lib/utils";
import type { Job } from "@/types/job";

type SortKey = "title" | "company" | "salary" | "fit" | "visa" | "posted" | "collected";
type SortDir = "asc" | "desc";

function SortIcon({ col, active, dir }: { col: string; active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
  return dir === "asc"
    ? <ChevronUp className="ml-1 inline h-3 w-3" />
    : <ChevronDown className="ml-1 inline h-3 w-3" />;
}

function salaryValue(job: Job): number {
  const s = job.salary_display ?? "";
  const nums = s.replace(/[$,k]/gi, "").match(/\d+/g);
  if (!nums) return 0;
  const avg = nums.reduce((a, b) => a + Number(b), 0) / nums.length;
  return s.toLowerCase().includes("k") ? avg * 1000 : avg;
}

const VISA_ORDER: Record<string, number> = { High: 3, Medium: 2, Low: 1, Unknown: 0 };

function sortJobs(jobs: Job[], key: SortKey, dir: SortDir): Job[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...jobs].sort((a, b) => {
    let delta = 0;
    switch (key) {
      case "title":   delta = (a.title ?? "").localeCompare(b.title ?? ""); break;
      case "company": delta = (a.company_name ?? "").localeCompare(b.company_name ?? ""); break;
      case "salary":  delta = salaryValue(a) - salaryValue(b); break;
      case "fit":     delta = (a.fit_score ?? 0) - (b.fit_score ?? 0); break;
      case "visa":    delta = (VISA_ORDER[a.visa_score ?? ""] ?? 0) - (VISA_ORDER[b.visa_score ?? ""] ?? 0); break;
      case "posted":    delta = Date.parse(a.date_posted ?? "") - Date.parse(b.date_posted ?? ""); break;
      case "collected": delta = Date.parse(a.first_seen_at ?? "") - Date.parse(b.first_seen_at ?? ""); break;
    }
    return delta * sign;
  });
}

function formatCollected(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const formatted = d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
  const month = parseInt(d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric" }));
  const tz = month >= 3 && month <= 11 ? "CDT" : "CST";
  return `${formatted} ${tz}`;
}

export function JobTable({
  jobs,
  onApply,
  onSelect,
  selectedJobId,
  title = "Active jobs",
}: {
  jobs: Job[];
  onApply?: (job: Job) => void;
  onSelect?: (job: Job) => void;
  selectedJobId?: number | null;
  title?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("posted");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = sortJobs(jobs, sortKey, sortDir);

  function Th({ col, label }: { col: SortKey; label: string }) {
    return (
      <TableHead
        className="cursor-pointer select-none whitespace-nowrap"
        onClick={() => handleSort(col)}
      >
        {label}
        <SortIcon col={col} active={sortKey === col} dir={sortDir} />
      </TableHead>
    );
  }

  return (
    <Card className="surface shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        <Badge variant="secondary">{jobs.length} shown</Badge>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <Th col="title"   label="Role" />
              <Th col="company" label="Company" />
              <Th col="salary"  label="Salary" />
              <Th col="fit"     label="Fit" />
              <Th col="visa"    label="Visa" />
              <Th col="posted"     label="Posted" />
              <Th col="collected" label="Collected" />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((job) => (
              <TableRow
                key={job.id}
                className={cn(
                  onSelect && "cursor-pointer",
                  selectedJobId === job.id && "bg-primary/8",
                )}
                onClick={() => onSelect?.(job)}
              >
                <TableCell className="max-w-[300px]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="line-clamp-2 font-medium leading-5">{cleanTitle(job.title)}</div>
                    {job.easy_apply && (
                      <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">Easy Apply</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{job.location ?? "Location not listed"} · {job.work_mode}</div>
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <div className="truncate" title={cleanCompanyName(job.company_name)}>
                    {cleanCompanyName(job.company_name)}
                  </div>
                  <div className="text-xs text-muted-foreground">{job.source}</div>
                </TableCell>
                <TableCell className="min-w-[120px] text-xs text-muted-foreground">
                  {job.salary_display ?? "—"}
                </TableCell>
                <TableCell className="min-w-32">
                  <div className="flex items-center gap-2">
                    <Progress value={job.fit_score} />
                    <span className="text-xs text-muted-foreground">{job.fit_score}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={job.visa_score === "High" ? "success" : job.visa_score === "Low" ? "destructive" : "warning"}>
                    {job.visa_score}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(job.date_posted)}</TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatCollected(job.first_seen_at)}</TableCell>
                <TableCell className="text-right">
                  {onApply ? (
                    <Button className="mr-2" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onApply(job); }}>
                      Mark applied
                    </Button>
                  ) : null}
                  {job.job_url ? (
                    <Button asChild variant="ghost" size="icon">
                      <a href={job.job_url} target="_blank" rel="noreferrer" aria-label={`Open ${job.title}`} onClick={(e) => e.stopPropagation()}>
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function cleanTitle(title: string) {
  const value = title.replace(/\s+/g, " ").trim();
  if (/^(recommended jobs|search jobs|job)$/i.test(value)) return "Job title not listed";
  return value;
}

function cleanCompanyName(companyName: string | null) {
  const value = (companyName ?? "Unknown").replace(/\s+/g, " ").trim();
  if (!value || value.length > 80 || /search jobs|set job alert|close filter|easy apply/i.test(value)) return "Company not listed";
  return value;
}
