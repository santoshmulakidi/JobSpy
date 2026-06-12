import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/app/globals.css";
import { AppProviders } from "@/components/providers/app-providers";

export const metadata: Metadata = {
  title: "Job Intelligence Platform",
  description: "Profile-based job intelligence, resume tailoring, and application tracking.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
