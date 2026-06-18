"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowUpRight, ChevronDown, ChevronUp, ChevronsUpDown, ExternalLink, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatDate } from "@/lib/utils";
import type { Job } from "@/types/job";

export type SortKey = "title" | "company" | "salary" | "fit" | "visa" | "posted" | "collected" | "best";
export type SortDir = "asc" | "desc";

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
  if (key === "best") {
    // composite: fit desc, then collected desc (newest batch of high-fit jobs first)
    return [...jobs].sort((a, b) => {
      const fitDelta = (b.fit_score ?? 0) - (a.fit_score ?? 0);
      if (fitDelta !== 0) return fitDelta;
      return Date.parse(b.first_seen_at ?? "") - Date.parse(a.first_seen_at ?? "");
    });
  }
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

function JobContextMenu({
  job,
  x,
  y,
  onClose,
  onSelect,
}: {
  job: Job;
  x: number;
  y: number;
  onClose: () => void;
  onSelect?: ((job: Job) => void) | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [onClose]);

  function openResumeLab() {
    window.sessionStorage.setItem("resumeLabJob", JSON.stringify({
      id: job.id,
      title: job.title,
      company: job.company_name,
      location: job.location,
      jobUrl: job.job_url,
      description: job.description ?? "",
      returnTo: "/jobs",
    }));
    window.open(`/resume-lab?jobId=${job.id}`, "_blank", "noopener");
    onClose();
  }

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top: y, left: x, zIndex: 9999 }}
      className="min-w-[200px] rounded-lg border bg-popover py-1 shadow-lg text-sm"
    >
      {job.job_url && (
        <a
          href={job.job_url}
          target="_blank"
          rel="noreferrer"
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-2 hover:bg-accent cursor-pointer text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          Open job in new tab
        </a>
      )}
      <button
        type="button"
        onClick={() => { onSelect?.(job); onClose(); }}
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-accent cursor-pointer text-left"
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        View job details
      </button>
      <button
        type="button"
        onClick={openResumeLab}
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-accent cursor-pointer text-left"
      >
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
        Open Resume Lab in new tab
      </button>
    </div>
  );
}

export function JobTable({
  jobs,
  onApply,
  onSelect,
  selectedJobIds,
  onToggleJobSelection,
  onToggleVisibleSelection,
  selectedJobId,
  title = "Active jobs",
  sortKey: externalSortKey,
  sortDir: externalSortDir,
  onSort,
}: {
  jobs: Job[];
  onApply?: (job: Job) => void;
  onSelect?: (job: Job) => void;
  selectedJobIds?: Set<number>;
  onToggleJobSelection?: (job: Job) => void;
  onToggleVisibleSelection?: (jobs: Job[]) => void;
  selectedJobId?: number | null;
  title?: string;
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSort?: (key: SortKey, dir: SortDir) => void;
}) {
  const [localSortKey, setLocalSortKey] = useState<SortKey>("best");
  const [localSortDir, setLocalSortDir] = useState<SortDir>("desc");
  const [ctxMenu, setCtxMenu] = useState<{ job: Job; x: number; y: number } | null>(null);

  // Use external sort if provided (parent controls full-dataset sort), else local
  const sortKey = externalSortKey ?? localSortKey;
  const sortDir = externalSortDir ?? localSortDir;

  function handleSort(key: SortKey) {
    const newDir = sortKey === key ? (sortDir === "asc" ? "desc" : "asc") : "desc";
    if (onSort) {
      onSort(key, newDir);
    } else {
      setLocalSortKey(key);
      setLocalSortDir(newDir);
    }
  }

  // Only re-sort locally when no external sort (external = already sorted by parent)
  const sorted = externalSortKey ? jobs : sortJobs(jobs, sortKey, sortDir);
  const allVisibleSelected = sorted.length > 0 && sorted.every((job) => selectedJobIds?.has(job.id));

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
    <>
    {ctxMenu && (
      <JobContextMenu
        job={ctxMenu.job}
        x={ctxMenu.x}
        y={ctxMenu.y}
        onClose={() => setCtxMenu(null)}
        onSelect={onSelect ?? undefined}
      />
    )}
    <Card className="surface shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        <Badge variant="secondary">{jobs.length} shown</Badge>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              {onToggleJobSelection ? (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select visible jobs"
                    checked={allVisibleSelected}
                    onChange={() => onToggleVisibleSelection?.(sorted)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border"
                  />
                </TableHead>
              ) : null}

              <Th col="title"   label="Role" />
              <Th col="company" label="Company" />
              <Th col="fit"     label="Fit" />
              <TableHead className="whitespace-nowrap">Resume</TableHead>
              <Th col="posted"  label="Posted / Collected" />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((job) => (
              <TableRow
                key={job.id}
                className={cn(
                  onSelect && "cursor-pointer",
                  selectedJobId === job.id && "bg-accent border-l-2 border-l-primary",
                )}
                onClick={() => onSelect?.(job)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ job, x: e.clientX, y: e.clientY }); }}
              >
                {onToggleJobSelection ? (
                  <TableCell className="w-10">
                    <input
                      type="checkbox"
                      aria-label={`Select ${job.title}`}
                      checked={Boolean(selectedJobIds?.has(job.id))}
                      onChange={() => onToggleJobSelection(job)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border"
                    />
                  </TableCell>
                ) : null}
                <TableCell className="max-w-[300px]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="line-clamp-2 font-medium leading-5">{cleanTitle(job.title)}</div>
                    {job.easy_apply && (
                      <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">Easy Apply</Badge>
                    )}
                    {job.resume_ready && (
                      <Badge className="shrink-0 text-[10px] px-1.5 py-0 bg-green-600 text-white">
                        Resume Ready · ATS {job.best_ats_score}%
                      </Badge>
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
                <TableCell className="min-w-32">
                  <div className="flex items-center gap-2">
                    <Progress value={job.fit_score} />
                    <span className="text-xs text-muted-foreground">{job.fit_score}</span>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {job.resume_ready ? (
                    <span className="font-semibold text-green-600">ATS {job.best_ats_score}%</span>
                  ) : job.best_ats_score != null ? (
                    <span className={`font-semibold ${job.best_ats_score >= 70 ? "text-yellow-600" : "text-red-500"}`}>
                      ATS {job.best_ats_score}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  <div>{formatDate(job.date_posted)}</div>
                  <div className="text-[11px] opacity-70">{formatCollected(job.first_seen_at)}</div>
                </TableCell>
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
    </>
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
