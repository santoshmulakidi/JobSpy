# Job Intelligence Frontend

Production-ready SaaS frontend for the Job Intelligence Platform.

## Stack

- Next.js 15 App Router
- React 19
- TypeScript strict mode
- Tailwind CSS
- shadcn/ui-style primitives
- Magic UI-inspired motion components
- Framer Motion
- Lucide React Icons
- next-themes
- Sonner toast notifications

## Install

```bash
cd /Users/santoshmulakidi/JobSpy/job-intelligence/frontend
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

The FastAPI backend should run separately:

```bash
cd /Users/santoshmulakidi/job-intelligence
/Users/santoshmulakidi/JobSpy/.venv/bin/python -m uvicorn api.main:app --host 127.0.0.1 --port 8000
```

Optional API override:

```bash
NEXT_PUBLIC_JOB_API_URL=http://127.0.0.1:8000 npm run dev
```

## Project Structure

```text
frontend/
├── app/
│   ├── dashboard/page.tsx
│   ├── collect/page.tsx
│   ├── jobs/page.tsx
│   ├── resume-lab/page.tsx
│   ├── applications/page.tsx
│   ├── saved-searches/page.tsx
│   ├── sources/page.tsx
│   ├── company-targets/page.tsx
│   ├── settings/page.tsx
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── dashboard/
│   ├── layout/
│   ├── magic/
│   ├── providers/
│   └── ui/
├── hooks/
├── lib/
├── types/
├── tailwind.config.ts
├── components.json
├── next.config.ts
└── package.json
```

## Component Architecture

- `components/ui`: shadcn/ui-compatible primitives such as Button, Card, Badge, Select, Tabs, Dialog, Sheet, Table, Progress, Skeleton, Toast.
- `components/magic`: Magic UI-inspired visual effects such as animated grid, blur fade, animated border, marquee, sparkles text, beam, and mobile dock.
- `components/layout`: responsive app shell, sidebar navigation, sticky topbar, breadcrumbs, search, notifications, profile menu.
- `components/dashboard`: feature components for SaaS metrics, active job table, traffic/source bars, and quick invite.
- `lib/api.ts`: typed FastAPI client.
- `types/job.ts`: typed backend contracts.

## Design Tokens

Design tokens live in `app/globals.css` and `tailwind.config.ts`.

Core tokens:

- `--background`
- `--foreground`
- `--card`
- `--primary`
- `--success`
- `--warning`
- `--destructive`
- `--border`
- `--ring`
- `--radius`

The frontend supports light mode, dark mode, system mode, accessible focus rings, and WCAG AA contrast-oriented color choices.

## shadcn/ui Setup

The repo includes `components.json` with aliases:

```json
{
  "components": "@/components",
  "utils": "@/lib/utils",
  "ui": "@/components/ui",
  "lib": "@/lib",
  "hooks": "@/hooks"
}
```

You can add official shadcn components later with:

```bash
npx shadcn@latest add button input textarea select dialog sheet card badge tabs tooltip dropdown-menu table skeleton progress
```

## Magic UI Integration

Magic UI-inspired components are implemented locally in `components/magic`.

Used effects:

- Animated hero section
- Animated grid pattern
- Blur fade
- Animated border
- Marquee
- Sparkles text
- Beam
- Mobile dock navigation
- Bento grid layout

## Framer Motion Integration

Framer Motion is used for:

- Blur/fade reveal
- Hover elevation
- Dock micro-interactions
- Future modal and page transition extensions

## Pages

- `/`: landing page
- `/dashboard`: SaaS dashboard using live FastAPI stats/jobs/applications
- `/jobs`: active 24-hour job feed
- `/collect`: source selection and fresh job collection
- `/resume-lab`: upload DOCX/TXT resumes, switch between profiles, and prepare tailored resume text
- `/applications`: applied jobs saved separately from the active feed
- `/saved-searches`: reusable search filters
- `/sources`: source counts and health surface
- `/company-targets`: visa-aware target companies with career links
- `/settings`: profile and automation settings example

## Production Notes

- Keep backend API calls server-side where possible.
- Add route-level loading states with `loading.tsx` for larger pages.
- Add auth boundary before multi-user rollout.
- Move mutation flows to Server Actions or a BFF route layer.
- Add Playwright visual regression checks before replacing the existing FastAPI-served static dashboard.
