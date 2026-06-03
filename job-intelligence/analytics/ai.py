from __future__ import annotations

from pydantic import BaseModel, Field


class JobAIInsights(BaseModel):
    summary: str | None = None
    skills: list[str] = Field(default_factory=list)
    category: str | None = None
    seniority: str | None = None
    technologies: list[str] = Field(default_factory=list)


class AIAnalyzer:
    """Provider-neutral AI extension point for OpenAI, Claude, and Gemini."""

    def analyze_job(self, title: str, description: str | None) -> JobAIInsights:
        # Wire provider clients here in Phase 5. The deterministic fallback keeps
        # API and dashboard code usable before external AI credentials exist.
        text = f"{title}\n{description or ''}".lower()
        seniority = "senior" if "senior" in text or "lead" in text else None
        return JobAIInsights(
            summary=(description or title)[:280],
            seniority=seniority,
        )
