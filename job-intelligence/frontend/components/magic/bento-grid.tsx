import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function BentoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 md:grid-cols-3", className)}>{children}</div>;
}

export function BentoCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("surface premium-ring rounded-2xl p-5 transition-colors hover:bg-card", className)}>
      {children}
    </div>
  );
}
