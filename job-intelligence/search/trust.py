from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

from storage.models import Job


HIGH_TRUST_SOURCES = {
    "career_page",
    "governmentjobs",
    "hiringcafe",
    "usajobs_api",
    "yc_jobs",
}

MEDIUM_TRUST_SOURCES = {
    "dice",
    "indeed",
    "jobright_h1b",
    "linkedin",
    "remotely",
}

RISK_TERMS = {
    "telegram": "asks to use Telegram",
    "whatsapp": "asks to use WhatsApp",
    "gift card": "mentions gift cards",
    "wire transfer": "mentions wire transfers",
    "crypto": "mentions crypto payment",
    "upfront fee": "mentions upfront fees",
    "processing fee": "mentions processing fees",
    "equipment check": "mentions equipment checks",
    "send money": "asks to send money",
    "personal bank": "asks for banking details",
    "cash app": "mentions Cash App",
    "zelle": "mentions Zelle",
}


@dataclass(frozen=True)
class TrustScore:
    trust_score: int
    trust_status: str
    trust_reasons: list[str]


def score_trust(job: Job) -> TrustScore:
    text = _job_text(job)
    source = (job.source or "").lower()
    score = 70
    reasons: list[str] = []

    if source in HIGH_TRUST_SOURCES:
        score += 20
        reasons.append("high-trust source")
    elif source in MEDIUM_TRUST_SOURCES:
        score += 10
        reasons.append("known job source")
    elif source:
        score += 2
        reasons.append("source captured")

    if job.company_name:
        score += 8
        reasons.append("company captured")
    if job.job_url and _valid_http_url(job.job_url):
        score += 7
        reasons.append("job link captured")

    matched_risks = [reason for term, reason in RISK_TERMS.items() if term in text]
    if matched_risks:
        score -= min(50, len(matched_risks) * 18)
        reasons.extend(matched_risks[:3])

    if "no experience required" in text and "$" in text:
        score -= 12
        reasons.append("unusual pay/experience signal")

    trust_score = max(0, min(100, score))
    if trust_score >= 80:
        status = "Verified"
    elif trust_score >= 55:
        status = "Review"
    else:
        status = "Risk"

    return TrustScore(
        trust_score=trust_score,
        trust_status=status,
        trust_reasons=reasons or ["needs source review"],
    )


def _job_text(job: Job) -> str:
    return " ".join(
        str(value or "")
        for value in (
            job.title,
            job.company_name,
            job.location,
            job.description,
            job.job_type,
            job.source,
            job.job_url,
        )
    ).lower()


def _valid_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
