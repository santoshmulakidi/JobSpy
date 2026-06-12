"use client";

import { BarChart3, BriefcaseBusiness, Building2, DatabaseZap, FileText, HeartHandshake, Home, LayoutDashboard, ListChecks, RadioTower, Settings, Sparkles, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/collect", label: "Collect", icon: DatabaseZap },
  { href: "/resume-lab", label: "Resume Lab", icon: FileText },
  { href: "/applications", label: "Applications", icon: ListChecks },
  { href: "/saved-searches", label: "Saved searches", icon: HeartHandshake },
  { href: "/sources", label: "Sources", icon: RadioTower },
  { href: "/company-targets", label: "Company targets", icon: Building2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ className, forceVisible = false }: { className?: string; forceVisible?: boolean }) {
  const pathname = usePathname();

  return (
    <aside className={cn(
      "fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-card/80 backdrop-blur-xl lg:flex lg:flex-col",
      forceVisible && "relative inset-auto flex h-full w-full flex-col lg:flex",
      className,
    )}>
      <div className="flex h-16 items-center gap-3 border-b px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium">Job Intelligence</p>
          <p className="text-xs text-muted-foreground">Profile job OS</p>
        </div>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        <div>
          <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Workspace</p>
          <nav className="space-y-1">
            <Link
              href="/"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                pathname === "/" && "bg-muted text-foreground",
              )}
            >
              <Home className="h-4 w-4" /> Home
            </Link>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                    active && "bg-primary/10 text-primary",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="rounded-xl border bg-background/65 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4 text-primary" /> Today’s focus
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Review fresh jobs, tailor resume, then move applied roles into tracker history.</p>
        </div>
      </div>
      <div className="border-t p-3">
        <Button variant="ghost" className="w-full justify-start gap-3">
          <UserRoundCheck className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
