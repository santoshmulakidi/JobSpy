import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Marquee({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]", className)}>
      <div className="flex min-w-full shrink-0 animate-marquee items-center gap-4 pr-4">{children}</div>
      <div aria-hidden="true" className="flex min-w-full shrink-0 animate-marquee items-center gap-4 pr-4">
        {children}
      </div>
    </div>
  );
}
