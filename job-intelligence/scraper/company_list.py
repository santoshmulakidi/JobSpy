"""
Curated list of companies that hire .NET / C# / Azure developers
and publish jobs via Greenhouse, Lever, or Ashby public APIs.

Each entry: (ats_platform, slug, display_name)
  - slug = the company identifier used in the ATS URL
  - display_name = human-readable company name stored in DB

Slugs verified from live search results June 2026.

Adding a new company:
  1. Confirm ATS:
     - Greenhouse: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
     - Lever:      https://api.lever.co/v0/postings/{slug}?mode=json
     - Ashby:      https://jobs.ashbyhq.com/{slug}
  2. Append a tuple below.
"""

from __future__ import annotations

COMPANIES: list[tuple[str, str, str]] = [
    # ── Greenhouse ────────────────────────────────────────────────────────
    # Fintech / Banking / Capital Markets
    ("greenhouse", "stripe",                    "Stripe"),
    ("greenhouse", "plaid",                     "Plaid"),
    ("greenhouse", "brex",                      "Brex"),
    ("greenhouse", "chime",                     "Chime"),
    ("greenhouse", "robinhood",                 "Robinhood"),
    ("greenhouse", "coinbase",                  "Coinbase"),
    ("greenhouse", "marqeta",                   "Marqeta"),
    ("greenhouse", "affirm",                    "Affirm"),
    ("greenhouse", "sofi",                      "SoFi"),
    ("greenhouse", "paylocity",                 "Paylocity"),
    ("greenhouse", "lendingtree",               "LendingTree"),        # verified: Senior SE .NET
    ("greenhouse", "point72",                   "Point72"),            # verified: quant finance .NET
    ("greenhouse", "oportun",                   "Oportun"),            # verified: fintech .NET
    ("greenhouse", "earnin",                    "EarnIn"),             # verified: fintech
    # Cloud / SaaS / Enterprise
    ("greenhouse", "datadog",                   "Datadog"),
    ("greenhouse", "okta",                      "Okta"),
    ("greenhouse", "twilio",                    "Twilio"),
    ("greenhouse", "zendesk",                   "Zendesk"),
    ("greenhouse", "hubspot",                   "HubSpot"),
    ("greenhouse", "docusign",                  "DocuSign"),
    ("greenhouse", "servicenow",                "ServiceNow"),
    ("greenhouse", "splunk",                    "Splunk"),
    ("greenhouse", "crowdstrike",               "CrowdStrike"),
    ("greenhouse", "pagerduty",                 "PagerDuty"),
    ("greenhouse", "newrelic",                  "New Relic"),
    ("greenhouse", "elastic",                   "Elastic"),
    ("greenhouse", "mongodb",                   "MongoDB"),
    ("greenhouse", "confluent",                 "Confluent"),
    ("greenhouse", "databricks",                "Databricks"),
    ("greenhouse", "snowflake",                 "Snowflake"),
    ("greenhouse", "anaplan",                   "Anaplan"),            # verified: Senior .NET Full Stack
    ("greenhouse", "nice",                      "NICE Systems"),       # verified: C#, ASP.NET
    ("greenhouse", "genea",                     "Genea"),              # verified: Senior SE II .NET Azure
    ("greenhouse", "remesh",                    "Remesh"),             # verified: SE Azure
    # Cybersecurity
    ("greenhouse", "threatlocker",              "ThreatLocker"),       # verified: C# .NET Developer
    ("greenhouse", "veeamsoftware",             "Veeam Software"),     # verified: C# heavy
    ("greenhouse", "opswat",                    "OPSWAT"),             # verified: security .NET
    # Azure / Cloud Consulting & IT Services
    ("greenhouse", "66degrees",                 "66degrees"),          # verified: .NET Architect Azure
    ("greenhouse", "accenturefederalservices",  "Accenture Federal Services"), # verified: .NET C# Azure
    ("greenhouse", "bpcs",                      "Blueprint Technologies"),     # verified: .NET & Azure
    ("greenhouse", "epam",                      "EPAM Systems"),
    ("greenhouse", "thoughtworks",              "Thoughtworks"),
    # Healthcare Tech
    ("greenhouse", "teladoc",                   "Teladoc Health"),
    ("greenhouse", "oscar",                     "Oscar Health"),
    ("greenhouse", "clover",                    "Clover Health"),
    ("greenhouse", "hims",                      "Hims & Hers"),
    ("greenhouse", "perfectserve",              "PerfectServe"),       # verified: .NET/C# US Remote
    ("greenhouse", "nationwidevision",          "Nationwide Vision"),  # verified: C#/.NET
    # E-commerce / Retail
    ("greenhouse", "wayfair",                   "Wayfair"),
    ("greenhouse", "chewy",                     "Chewy"),
    ("greenhouse", "poshmark",                  "Poshmark"),
    # Gaming / Entertainment
    ("greenhouse", "riotgames",                 "Riot Games"),
    ("greenhouse", "rockstargames",             "Rockstar Games"),     # verified: .NET C# Full Stack
    ("greenhouse", "niantic",                   "Niantic"),
    ("greenhouse", "scopely",                   "Scopely"),
    ("greenhouse", "speechify",                 "Speechify"),          # verified: C# XAML Windows
    # Productivity / Collaboration / Other Tech
    ("greenhouse", "discord",                   "Discord"),
    ("greenhouse", "figma",                     "Figma"),
    ("greenhouse", "notion",                    "Notion"),
    ("greenhouse", "asana",                     "Asana"),
    ("greenhouse", "airtable",                  "Airtable"),
    ("greenhouse", "zapier",                    "Zapier"),
    ("greenhouse", "gusto",                     "Gusto"),
    ("greenhouse", "carta",                     "Carta"),
    ("greenhouse", "lattice",                   "Lattice"),
    ("greenhouse", "benchling",                 "Benchling"),
    ("greenhouse", "verkada",                   "Verkada"),
    ("greenhouse", "samsara",                   "Samsara"),
    ("greenhouse", "rivian",                    "Rivian"),
    ("greenhouse", "lucid",                     "Lucid Motors"),
    # Legal / GovTech / Enterprise Software
    ("greenhouse", "relativity",                "Relativity"),         # legal tech, heavy .NET
    ("greenhouse", "tylertech",                 "Tyler Technologies"), # gov software, .NET heavy
    ("greenhouse", "avalara",                   "Avalara"),            # tax software, .NET heavy
    ("greenhouse", "blackbaud",                 "Blackbaud"),          # nonprofit software, .NET
    ("greenhouse", "maximus",                   "Maximus"),            # gov IT services, .NET
    ("greenhouse", "verint",                    "Verint"),             # workforce engagement, .NET
    # ── Lever ─────────────────────────────────────────────────────────────
    ("lever",      "lyft",                      "Lyft"),
    ("lever",      "reddit",                    "Reddit"),
    ("lever",      "etsy",                      "Etsy"),
    ("lever",      "duolingo",                  "Duolingo"),
    ("lever",      "klaviyo",                   "Klaviyo"),
    ("lever",      "toast",                     "Toast"),
    ("lever",      "housecall-pro",             "Housecall Pro"),
    ("lever",      "samsara",                   "Samsara"),
    ("lever",      "amplitude",                 "Amplitude"),
    ("lever",      "mixpanel",                  "Mixpanel"),
    ("lever",      "heap",                      "Heap"),
    ("lever",      "segment",                   "Segment"),
    ("lever",      "contentful",                "Contentful"),
    ("lever",      "miro",                      "Miro"),
    ("lever",      "lucidchart",                "Lucidchart"),
    ("lever",      "smartsheet",                "Smartsheet"),
    ("lever",      "procore",                   "Procore Technologies"),
    ("lever",      "autodesk",                  "Autodesk"),
    ("lever",      "palantir",                  "Palantir Technologies"),
    # Verified .NET-hiring Lever companies (June 2026 search)
    ("lever",      "flynncompanies",            "Flynn Group of Companies"), # verified: .NET C# Azure
    ("lever",      "Allata",                    "Allata"),             # verified: .NET Core Azure/AWS
    ("lever",      "oowlish",                   "Oowlish Technology"), # verified: .NET Azure Full Stack
    ("lever",      "keyloop",                   "Keyloop"),            # verified: .NET C# React
    ("lever",      "patchmypc",                 "Patch My PC"),        # verified: ASP.NET Core backend
    ("lever",      "pditechnologies",           "PDI Technologies"),   # verified: .NET C# Azure
    ("lever",      "jobgether",                 "Jobgether"),          # verified: C# .NET Angular
    # Enterprise / B2B SaaS on Lever
    ("lever",      "genesys",                   "Genesys"),            # contact center, heavy .NET
    ("lever",      "versapay",                  "Versapay"),           # payments, Principal .NET
    ("lever",      "cyncly",                    "Cyncly"),             # design software, .NET
    ("lever",      "bottomline",                "Bottomline Technologies"), # fintech, .NET heavy
    ("lever",      "ncino",                     "nCino"),              # banking software
    ("lever",      "xero",                      "Xero"),               # accounting SaaS
    ("lever",      "zuora",                     "Zuora"),              # subscription management
    ("lever",      "bazaarvoice",               "Bazaarvoice"),        # e-commerce tech
    ("lever",      "apttus",                    "Conga"),              # contract management
    ("lever",      "solarwinds",                "SolarWinds"),         # IT management, .NET
    ("lever",      "progress",                  "Progress Software"),  # .NET tools (Telerik)
    # ── Ashby ─────────────────────────────────────────────────────────────
    ("ashby",      "linear",                    "Linear"),
    ("ashby",      "retool",                    "Retool"),
    ("ashby",      "dbt-labs",                  "dbt Labs"),
    ("ashby",      "vercel",                    "Vercel"),
    ("ashby",      "supabase",                  "Supabase"),
    ("ashby",      "planetscale",               "PlanetScale"),
    ("ashby",      "turso",                     "Turso"),
    ("ashby",      "clerk",                     "Clerk"),
    ("ashby",      "modal-labs",                "Modal Labs"),
    ("ashby",      "fly-io",                    "Fly.io"),
    ("ashby",      "render",                    "Render"),
    ("ashby",      "posthog",                   "PostHog"),
    ("ashby",      "metabase",                  "Metabase"),
    ("ashby",      "temporal",                  "Temporal"),
    ("ashby",      "stytch",                    "Stytch"),
    ("ashby",      "incident-io",               "incident.io"),
    ("ashby",      "airplane",                  "Airplane"),
    ("ashby",      "courier",                   "Courier"),
    ("ashby",      "draftbit",                  "Draftbit"),
    # Verified .NET-hiring Ashby companies (June 2026 search)
    ("ashby",      "leantechniques",            "Lean TECHniques"),    # verified: .NET Angular React
    ("ashby",      "deel",                      "Deel"),               # verified: .NET Core C# Remote
    ("ashby",      "truelogic",                 "Truelogic"),          # verified: Principal .NET Angular
    ("ashby",      "nord-security",             "Nord Security"),      # verified: C#/.NET Windows
    ("ashby",      "opengov",                   "OpenGov"),            # verified: C# .NET GovTech
    # More Ashby companies known to hire .NET
    ("ashby",      "workos",                    "WorkOS"),             # enterprise auth, .NET SDKs
    ("ashby",      "brainware",                 "Brainware"),          # document capture
    ("ashby",      "forma",                     "Forma"),              # benefits platform
    ("ashby",      "replit",                    "Replit"),             # dev tools
    ("ashby",      "codeium",                   "Codeium"),            # AI coding
    ("ashby",      "glean",                     "Glean"),              # enterprise search
    ("ashby",      "ramp",                      "Ramp"),               # fintech / spend management
    ("ashby",      "rippling",                  "Rippling"),           # HR / IT platform
]
