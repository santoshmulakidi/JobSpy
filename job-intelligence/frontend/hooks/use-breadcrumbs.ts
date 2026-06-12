"use client";

import { usePathname } from "next/navigation";

export function useBreadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);

  if (!parts.length) return [{ label: "Home", href: "/" }];

  return [
    { label: "Home", href: "/" },
    ...parts.map((part, index) => ({
      label: part.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      href: `/${parts.slice(0, index + 1).join("/")}`,
    })),
  ];
}
