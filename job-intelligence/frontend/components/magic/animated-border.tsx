import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function AnimatedBorder({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl p-px", className)}>
      <div className="absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,transparent,transparent,theme(colors.primary.DEFAULT),transparent,transparent)] bg-[length:700px_100%] opacity-40" />
      <div className="relative rounded-[calc(1rem-1px)] bg-card">{children}</div>
    </div>
  );
}
