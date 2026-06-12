"use client";

import { BriefcaseBusiness, DatabaseZap, FileText, LayoutDashboard, Settings } from "lucide-react";
import type { ReactNode } from "react";

import { Dock } from "@/components/magic/dock";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

const dockItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/collect", label: "Collect", icon: DatabaseZap },
  { href: "/resume-lab", label: "Resume Lab", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="lg:pl-64">
        <Topbar />
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </div>
      <Dock items={dockItems} />
    </div>
  );
}
