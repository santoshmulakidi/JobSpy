"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

export function Dock({
  items,
  className,
}: {
  items: { href: string; label: string; icon: ComponentType<{ className?: string }> }[];
  className?: string;
}) {
  return (
    <nav className={cn("fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 gap-2 rounded-2xl border bg-card/90 p-2 shadow-glow backdrop-blur-xl md:hidden", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <motion.div key={item.href} whileTap={{ scale: 0.94 }}>
            <Link className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground" href={item.href} aria-label={item.label}>
              <Icon className="h-4 w-4" />
            </Link>
          </motion.div>
        );
      })}
    </nav>
  );
}
