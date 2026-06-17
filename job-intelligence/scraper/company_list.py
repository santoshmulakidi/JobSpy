"""
Curated list of companies that hire .NET / C# / Azure developers
and publish jobs via Greenhouse, Lever, or Ashby public APIs.

Each entry: (ats_platform, slug, display_name)
  - slug = the company identifier used in the ATS URL
  - display_name = human-readable company name stored in DB

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
    # Fintech / Banking
    ("greenhouse", "stripe",             "Stripe"),
    ("greenhouse", "plaid",              "Plaid"),
    ("greenhouse", "brex",               "Brex"),
    ("greenhouse", "chime",              "Chime"),
    ("greenhouse", "robinhood",          "Robinhood"),
    ("greenhouse", "coinbase",           "Coinbase"),
    ("greenhouse", "marqeta",            "Marqeta"),
    ("greenhouse", "affirm",             "Affirm"),
    ("greenhouse", "sofi",               "SoFi"),
    ("greenhouse", "paylocity",          "Paylocity"),
    # Cloud / SaaS / Enterprise
    ("greenhouse", "datadog",            "Datadog"),
    ("greenhouse", "okta",               "Okta"),
    ("greenhouse", "twilio",             "Twilio"),
    ("greenhouse", "zendesk",            "Zendesk"),
    ("greenhouse", "hubspot",            "HubSpot"),
    ("greenhouse", "docusign",           "DocuSign"),
    ("greenhouse", "servicenow",         "ServiceNow"),
    ("greenhouse", "splunk",             "Splunk"),
    ("greenhouse", "crowdstrike",        "CrowdStrike"),
    ("greenhouse", "pagerduty",          "PagerDuty"),
    ("greenhouse", "newrelic",           "New Relic"),
    ("greenhouse", "elastic",            "Elastic"),
    ("greenhouse", "mongodb",            "MongoDB"),
    ("greenhouse", "confluent",          "Confluent"),
    ("greenhouse", "databricks",         "Databricks"),
    ("greenhouse", "snowflake",          "Snowflake"),
    # Healthcare / Insurance
    ("greenhouse", "teladoc",            "Teladoc Health"),
    ("greenhouse", "oscar",              "Oscar Health"),
    ("greenhouse", "clover",             "Clover Health"),
    ("greenhouse", "hims",               "Hims & Hers"),
    # E-commerce / Retail
    ("greenhouse", "wayfair",            "Wayfair"),
    ("greenhouse", "chewy",              "Chewy"),
    ("greenhouse", "poshmark",           "Poshmark"),
    # Gaming
    ("greenhouse", "riotgames",          "Riot Games"),
    ("greenhouse", "niantic",            "Niantic"),
    ("greenhouse", "scopely",            "Scopely"),
    # Other Tech
    ("greenhouse", "discord",            "Discord"),
    ("greenhouse", "figma",              "Figma"),
    ("greenhouse", "notion",             "Notion"),
    ("greenhouse", "asana",              "Asana"),
    ("greenhouse", "airtable",           "Airtable"),
    ("greenhouse", "zapier",             "Zapier"),
    ("greenhouse", "gusto",              "Gusto"),
    ("greenhouse", "carta",              "Carta"),
    ("greenhouse", "lattice",            "Lattice"),
    ("greenhouse", "benchling",          "Benchling"),
    ("greenhouse", "verkada",            "Verkada"),
    ("greenhouse", "samsara",            "Samsara"),
    ("greenhouse", "rivian",             "Rivian"),
    ("greenhouse", "lucid",              "Lucid Motors"),
    # Consulting / IT Services
    ("greenhouse", "epam",               "EPAM Systems"),
    ("greenhouse", "thoughtworks",       "Thoughtworks"),
    # ── Lever ─────────────────────────────────────────────────────────────
    ("lever",      "lyft",               "Lyft"),
    ("lever",      "reddit",             "Reddit"),
    ("lever",      "etsy",               "Etsy"),
    ("lever",      "duolingo",           "Duolingo"),
    ("lever",      "klaviyo",            "Klaviyo"),
    ("lever",      "toast",              "Toast"),
    ("lever",      "housecall-pro",      "Housecall Pro"),
    ("lever",      "samsara",            "Samsara"),
    ("lever",      "amplitude",          "Amplitude"),
    ("lever",      "mixpanel",           "Mixpanel"),
    ("lever",      "heap",               "Heap"),
    ("lever",      "segment",            "Segment"),
    ("lever",      "contentful",         "Contentful"),
    ("lever",      "miro",               "Miro"),
    ("lever",      "figma",              "Figma"),
    ("lever",      "lucidchart",         "Lucidchart"),
    ("lever",      "smartsheet",         "Smartsheet"),
    ("lever",      "procore",            "Procore Technologies"),
    ("lever",      "autodesk",           "Autodesk"),
    ("lever",      "palantir",           "Palantir Technologies"),
    # ── Ashby ─────────────────────────────────────────────────────────────
    ("ashby",      "linear",             "Linear"),
    ("ashby",      "retool",             "Retool"),
    ("ashby",      "dbt-labs",           "dbt Labs"),
    ("ashby",      "vercel",             "Vercel"),
    ("ashby",      "supabase",           "Supabase"),
    ("ashby",      "planetscale",        "PlanetScale"),
    ("ashby",      "turso",              "Turso"),
    ("ashby",      "clerk",              "Clerk"),
    ("ashby",      "modal-labs",         "Modal Labs"),
    ("ashby",      "fly-io",             "Fly.io"),
    ("ashby",      "render",             "Render"),
    ("ashby",      "posthog",            "PostHog"),
    ("ashby",      "metabase",           "Metabase"),
    ("ashby",      "temporal",           "Temporal"),
    ("ashby",      "stytch",             "Stytch"),
    ("ashby",      "incident-io",        "incident.io"),
    ("ashby",      "airplane",           "Airplane"),
    ("ashby",      "courier",            "Courier"),
    ("ashby",      "draftbit",           "Draftbit"),
]
