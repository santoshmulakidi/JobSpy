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
    # Companies verified on Greenhouse (moved from assumed Lever)
    ("greenhouse", "lyft",                      "Lyft"),
    ("greenhouse", "reddit",                    "Reddit"),
    ("greenhouse", "duolingo",                  "Duolingo"),
    ("greenhouse", "klaviyo",                   "Klaviyo"),
    ("greenhouse", "toast",                     "Toast"),
    ("greenhouse", "samsara",                   "Samsara"),
    ("greenhouse", "amplitude",                 "Amplitude"),
    ("greenhouse", "mixpanel",                  "Mixpanel"),
    ("greenhouse", "smartsheet",                "Smartsheet"),
    ("greenhouse", "contentful",                "Contentful"),
    ("greenhouse", "solarwinds",                "SolarWinds"),
    ("greenhouse", "zuora",                     "Zuora"),
    # E-commerce / Streaming / Consumer Tech
    ("greenhouse", "roku",                      "Roku"),
    # ── Lever (verified 200 slugs only) ───────────────────────────────────
    ("lever",      "netflix",                   "Netflix"),
    ("lever",      "metasite",                  "Metasite"),
    ("lever",      "palantir",                  "Palantir Technologies"),
    ("lever",      "flynncompanies",            "Flynn Group of Companies"),
    ("lever",      "Allata",                    "Allata"),
    ("lever",      "oowlish",                   "Oowlish Technology"),
    ("lever",      "keyloop",                   "Keyloop"),
    ("lever",      "patchmypc",                 "Patch My PC"),
    ("lever",      "pditechnologies",           "PDI Technologies"),
    ("lever",      "versapay",                  "Versapay"),
    ("lever",      "bazaarvoice",               "Bazaarvoice"),
    # ── Ashby ─────────────────────────────────────────────────────────────
    # Companies verified on Ashby (moved from assumed Lever)
    ("ashby",      "etsy",                      "Etsy"),
    ("ashby",      "lucidchart",                "Lucidchart"),
    ("ashby",      "miro",                      "Miro"),
    ("ashby",      "genesys",                   "Genesys"),
    ("ashby",      "procore",                   "Procore Technologies"),
    ("ashby",      "autodesk",                  "Autodesk"),
    ("ashby",      "heap",                      "Heap"),
    ("ashby",      "segment",                   "Segment"),
    ("ashby",      "progress",                  "Progress Software"),
    ("ashby",      "ncino",                     "nCino"),
    ("ashby",      "xero",                      "Xero"),
    ("ashby",      "apttus",                    "Conga"),
    ("ashby",      "cyncly",                    "Cyncly"),
    ("ashby",      "bottomline",                "Bottomline Technologies"),
    # Verified .NET-hiring Ashby companies
    ("ashby",      "leantechniques",            "Lean TECHniques"),
    ("ashby",      "deel",                      "Deel"),
    ("ashby",      "truelogic",                 "Truelogic"),
    ("ashby",      "nord-security",             "Nord Security"),
    ("ashby",      "opengov",                   "OpenGov"),
    ("ashby",      "workos",                    "WorkOS"),
    ("ashby",      "glean",                     "Glean"),
    ("ashby",      "ramp",                      "Ramp"),
    ("ashby",      "rippling",                  "Rippling"),
]
