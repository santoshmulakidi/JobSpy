from __future__ import annotations

from dataclasses import dataclass
import hashlib
import re


TECH_TERMS = (
    "C#", ".NET", "ASP.NET Core", "Java", "Python", "PyTorch", "TensorFlow",
    "Azure", "AWS", "GCP", "SQL", "SQL Server", "PostgreSQL", "MongoDB",
    "React", "Angular", "TypeScript", "JavaScript", "REST API", "REST APIs",
    "Microservices", "Docker", "Kubernetes", "LangChain", "LLM", "RAG",
    "Machine Learning", "Artificial Intelligence", "NLP", "CI/CD", "Git",
)

ALIASES = {
    "dotnet": ".net",
    "c sharp": "c#",
    "restful api": "rest api",
    "rest apis": "rest api",
}


@dataclass(frozen=True)
class KeywordPlan:
    supported: list[str]
    unsupported: list[str]
    placements: dict[str, str]


def _normalize_term(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value.strip().lower())
    return ALIASES.get(normalized, normalized)


def normalized_hash(*parts: str) -> str:
    normalized = "\x1f".join(re.sub(r"\s+", " ", part).strip() for part in parts)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def extract_target_title(explicit_title: str | None, job_description: str) -> str:
    if explicit_title and explicit_title.strip():
        return explicit_title.strip()
    for line in job_description.splitlines():
        value = line.strip().strip("#*:- ")
        if value and len(value) <= 100 and re.search(r"\b(engineer|developer|architect|analyst|manager)\b", value, re.I):
            return value
    return "Target Role"


def build_keyword_plan(
    source_resume: str, job_description: str, *, target_title: str | None = None
) -> KeywordPlan:
    source = _normalize_term(source_resume)
    jd = _normalize_term(job_description)
    title = _normalize_term(target_title or "")
    found: list[str] = []
    for term in TECH_TERMS:
        normalized = _normalize_term(term)
        if normalized in jd and normalized not in {_normalize_term(item) for item in found}:
            found.append(term)
    found.sort(key=lambda term: jd.index(_normalize_term(term)))
    supported = [term for term in found if _normalize_term(term) in source]
    unsupported = [
        term for term in found
        if _normalize_term(term) not in source and _normalize_term(term) != title
    ]
    placements = {
        term: "skills" if len(term.split()) <= 2 else "recent_roles"
        for term in supported
    }
    return KeywordPlan(supported=supported, unsupported=unsupported, placements=placements)


def replace_two_recent_titles(resume_text: str, target_title: str) -> tuple[str, list[str]]:
    lines = resume_text.splitlines()
    in_experience = False
    originals: list[str] = []
    section_re = re.compile(r"^(education|technical skills|skills|certifications?|projects?)\s*:?$", re.I)
    for index, line in enumerate(lines):
        stripped = line.strip()
        if re.match(r"^(professional |work )?experience\s*:?$", stripped, re.I):
            in_experience = True
            continue
        if in_experience and section_re.match(stripped):
            break
        if in_experience and "|" in stripped and len(originals) < 2:
            title, remainder = stripped.split("|", 1)
            if title.strip() and remainder.strip():
                originals.append(title.strip())
                prefix = line[: len(line) - len(line.lstrip())]
                lines[index] = f"{prefix}{target_title.strip()} |{remainder}"
    return "\n".join(lines), originals
