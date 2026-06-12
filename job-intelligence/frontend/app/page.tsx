import { ArrowRight, BriefcaseBusiness, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { AnimatedBorder } from "@/components/magic/animated-border";
import { AnimatedGridPattern } from "@/components/magic/animated-grid-pattern";
import { BentoCard, BentoGrid } from "@/components/magic/bento-grid";
import { BlurFade } from "@/components/magic/blur-fade";
import { Marquee } from "@/components/magic/marquee";
import { SparklesText } from "@/components/magic/sparkles-text";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const features = [
  "24h active job feed",
  "Resume Lab",
  "Visa-aware scoring",
  "Application tracker",
  "Source health",
  "Profile matching",
];

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <AnimatedGridPattern />
      <section className="container relative z-10 flex min-h-screen flex-col items-center justify-center py-24 text-center">
        <BlurFade>
          <Badge variant="secondary" className="mb-5">Production SaaS frontend</Badge>
        </BlurFade>
        <BlurFade delay={0.08}>
          <h1 className="max-w-5xl text-balance text-5xl font-medium tracking-tight sm:text-6xl lg:text-7xl">
            A premium <SparklesText>job intelligence</SparklesText> workspace for focused applications.
          </h1>
        </BlurFade>
        <BlurFade delay={0.16}>
          <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
            Collect fresh roles, rank them against your profile, tailor resumes, and preserve applied jobs in a clean application system.
          </p>
        </BlurFade>
        <BlurFade delay={0.24}>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/dashboard">Open dashboard <ArrowRight className="h-4 w-4" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/jobs">Review jobs</Link>
            </Button>
          </div>
        </BlurFade>

        <AnimatedBorder className="mt-14 w-full max-w-5xl">
          <div className="grid gap-4 p-4 md:grid-cols-3">
            <div className="rounded-xl bg-background/80 p-5 text-left">
              <BriefcaseBusiness className="mb-4 h-5 w-5 text-primary" />
              <h2 className="text-lg font-medium">Active jobs</h2>
              <p className="mt-2 text-sm text-muted-foreground">Main feed stays fresh with 24-hour active jobs and automatic archival.</p>
            </div>
            <div className="rounded-xl bg-background/80 p-5 text-left">
              <Sparkles className="mb-4 h-5 w-5 text-primary" />
              <h2 className="text-lg font-medium">Resume workflows</h2>
              <p className="mt-2 text-sm text-muted-foreground">Attach a base resume, choose a profile, and generate job-specific prompts.</p>
            </div>
            <div className="rounded-xl bg-background/80 p-5 text-left">
              <ShieldCheck className="mb-4 h-5 w-5 text-primary" />
              <h2 className="text-lg font-medium">Trust signals</h2>
              <p className="mt-2 text-sm text-muted-foreground">Visa status, source quality, profile fit, and application history stay visible.</p>
            </div>
          </div>
        </AnimatedBorder>
      </section>

      <section className="container relative z-10 pb-20">
        <Marquee>
          {features.map((feature) => (
            <Badge key={feature} variant="outline" className="bg-card/80 px-4 py-2">{feature}</Badge>
          ))}
        </Marquee>
        <BentoGrid className="mt-10">
          <BentoCard className="md:col-span-2">
            <h3 className="text-xl font-medium">Built like a SaaS product</h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Next.js App Router, Server Components, shadcn-style primitives, Magic UI-inspired motion, and strict TypeScript.</p>
          </BentoCard>
          <BentoCard>
            <h3 className="text-xl font-medium">Backend-ready</h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Reads from the existing FastAPI job intelligence backend through a typed API client.</p>
          </BentoCard>
        </BentoGrid>
      </section>
    </main>
  );
}
