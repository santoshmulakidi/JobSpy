"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function MotionCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={cn("rounded-xl", className)}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
    >
      {children}
    </motion.div>
  );
}
