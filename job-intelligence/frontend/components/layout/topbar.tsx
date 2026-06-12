"use client";

import { Bell, Menu, Search, User } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/providers/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "@/components/layout/sidebar";
import { useBreadcrumbs } from "@/hooks/use-breadcrumbs";

export function Topbar() {
  const breadcrumbs = useBreadcrumbs();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/82 px-4 backdrop-blur-xl lg:px-6">
      <Sheet>
        <SheetTrigger asChild>
          <Button className="lg:hidden" variant="ghost" size="icon" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent className="left-0 top-0 h-full max-w-72 translate-x-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar forceVisible />
        </SheetContent>
      </Sheet>

      <nav aria-label="Breadcrumb" className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
        {breadcrumbs.map((item, index) => (
          <span key={item.href} className="flex items-center gap-2">
            {index > 0 ? <span>/</span> : null}
            <Link className="hover:text-foreground" href={item.href}>{item.label}</Link>
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden w-72 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search jobs, companies, skills" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open notifications">
              <Bell className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>169 active jobs in the 24h feed</DropdownMenuItem>
            <DropdownMenuItem>Applications are saved separately</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Open user menu" className="rounded-full">
              <User className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Santosh</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
