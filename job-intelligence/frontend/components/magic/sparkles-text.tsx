import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SparklesText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <span className="bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent">{children}</span>
      <span aria-hidden="true" className="absolute -right-4 -top-2 text-primary">✦</span>
    </span>
  );
}
