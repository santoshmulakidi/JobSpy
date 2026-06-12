import type { ComponentType } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn, formatNumber } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  trend,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: number;
  trend: string;
  icon: ComponentType<{ className?: string }>;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  return (
    <Card className="surface shadow-none">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-medium tracking-tight">{formatNumber(value)}</p>
          </div>
          <div
            className={cn(
              "rounded-xl p-2",
              tone === "primary" && "bg-primary/10 text-primary",
              tone === "success" && "bg-success/15 text-success",
              tone === "warning" && "bg-warning/18 text-warning",
              tone === "danger" && "bg-destructive/12 text-destructive",
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{trend}</p>
      </CardContent>
    </Card>
  );
}
