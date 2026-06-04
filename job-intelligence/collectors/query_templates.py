from __future__ import annotations

from collectors.company_targets import company_search_fragment


def build_source_query(site: str, search_term: str, company: str, visa_friendly: bool = False) -> str:
    company_term = company_search_fragment(company)
    base = " ".join(search_term.split())
    visa_terms = " H1B sponsorship visa" if visa_friendly else ""

    if site == "google":
        return f'{base} "{company_term}" jobs{visa_terms}'.strip()
    if site == "indeed":
        return f'{base} "{company_term}"{visa_terms}'.strip()
    if site == "linkedin":
        return f"{base} {company_term}{visa_terms}".strip()
    return f"{base} {company_term}{visa_terms}".strip()
