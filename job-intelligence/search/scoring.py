from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from storage.models import Job, UserProfile


@dataclass(frozen=True)
class JobScore:
    fit_score: int
    qualification_status: str
    qualification_reasons: list[str]
    matched_skills: list[str]
    missing_skills: list[str]


def score_job(job: Job, profile: UserProfile) -> JobScore:
    text = _job_text(job)
    target_roles = _terms(profile.target_roles)
    skills = _terms(profile.skills)
    locations = _terms(profile.preferred_locations)
    excluded = _terms(profile.excluded_keywords)

    score = 0
    reasons: list[str] = []

    role_matches = [role for role in target_roles if role in text]
    if role_matches:
        score += 25
        reasons.append("target role match")

    matched_skills = [skill for skill in skills if skill in text]
    missing_skills = [skill for skill in skills if skill not in matched_skills]
    if matched_skills:
        score += min(30, len(matched_skills) * 8)
        reasons.append(f"{len(matched_skills)} skill match{'es' if len(matched_skills) != 1 else ''}")

    if locations and (job.is_remote or any(location in text for location in locations)):
        score += 15
        reasons.append("location/work-mode match")

    if job.visa_score == "High":
        score += 20
        reasons.append("strong visa signal")
    elif job.visa_score == "Medium":
        score += 10
        reasons.append("possible visa signal")

    if job.apply_priority == "High":
        score += 10
        reasons.append("fresh high-priority posting")

    excluded_matches = [term for term in excluded if term in text]
    if excluded_matches:
        score -= 30
        reasons.append(f"excluded keyword: {excluded_matches[0]}")

    visa_blocked = job.visa_status in {"No sponsorship", "USC/GC required", "W2 only"}
    if visa_blocked:
        score = min(score, 39)
        reasons.append(f"visa risk: {job.visa_status}")

    fit_score = max(0, min(100, score))
    if fit_score >= 55 and not visa_blocked:
        status = "Qualified"
    elif fit_score >= 40 and not visa_blocked:
        status = "Needs Review"
    else:
        status = "Disqualified"

    return JobScore(
        fit_score=fit_score,
        qualification_status=status,
        qualification_reasons=reasons or ["needs manual review"],
        matched_skills=[_display_term(skill, profile.skills) for skill in matched_skills],
        missing_skills=[_display_term(skill, profile.skills) for skill in missing_skills[:8]],
    )


def _job_text(job: Job) -> str:
    values: list[Any] = [
        job.title,
        job.company_name,
        job.location,
        job.description,
        job.job_type,
        job.source,
        job.visa_status,
        job.work_mode,
    ]
    return " ".join(str(value or "") for value in values).lower()


def _terms(values: list[str] | None) -> list[str]:
    return [str(value).strip().lower() for value in values or [] if str(value).strip()]


def _display_term(term: str, original_values: list[str] | None) -> str:
    for value in original_values or []:
        if value.strip().lower() == term:
            return value.strip()
    return term
