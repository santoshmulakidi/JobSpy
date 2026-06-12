"use client";

import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatDate } from "@/lib/utils";
import type { Job } from "@/types/job";

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
              <TableHead>Role</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Fit</TableHead>
              <TableHead>Visa</TableHead>
              <TableHead>Posted</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow
                key={job.id}
                className={cn(
                  onSelect && "cursor-pointer",
                  selectedJobId === job.id && "bg-primary/8",
                )}
                onClick={() => onSelect?.(job)}
              >
                <TableCell className="max-w-[340px]">
                  <div className="line-clamp-2 font-medium leading-5">{cleanTitle(job.title)}</div>
                  <div className="text-xs text-muted-foreground">{job.location ?? "Location not listed"}</div>
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <div className="truncate" title={cleanCompanyName(job.company_name)}>
                    {cleanCompanyName(job.company_name)}
                  </div>
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
                <TableCell className="text-right">
                  {onApply ? (
                    <Button className="mr-2" variant="outline" size="sm" onClick={(event) => {
                      event.stopPropagation();
                      onApply(job);
                    }}>
                      Mark applied
                    </Button>
                  ) : null}
                  {job.job_url ? (
                    <Button asChild variant="ghost" size="icon">
                      <a href={job.job_url} target="_blank" rel="noreferrer" aria-label={`Open ${job.title}`} onClick={(event) => event.stopPropagation()}>
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
  if (/^(recommended jobs|search jobs|job)$/i.test(value)) {
    return "Job title not listed";
  }
  return value;
}

function cleanCompanyName(companyName: string | null) {
  const value = (companyName ?? "Unknown").replace(/\s+/g, " ").trim();
  if (!value || value.length > 80 || /search jobs|set job alert|close filter|easy apply/i.test(value)) {
    return "Company not listed";
  }
  return value;
}
