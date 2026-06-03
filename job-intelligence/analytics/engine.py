from __future__ import annotations

import re
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from storage.models import Job
from storage.repository import JobRepository


SKILL_TERMS = [
    ".net",
    "agile",
    "aws",
    "azure",
    "c#",
    "ci/cd",
    "docker",
    "fastapi",
    "gcp",
    "java",
    "javascript",
    "kubernetes",
    "linux",
    "python",
    "react",
    "sql",
    "typescript",
]


class AnalyticsEngine:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.repository = JobRepository(session)

    def overview(self) -> dict:
        return {
            "trending_companies": self.trending_companies(),
            "location_trends": self.location_trends(),
            "salary_trends": self.salary_trends(),
            "most_requested_skills": self.most_requested_skills(),
        }

    def trending_companies(self, limit: int = 20) -> list[dict]:
        return [{"company": company, "job_count": count} for company, count in self.repository.company_counts(limit)]

    def location_trends(self, limit: int = 20) -> list[dict]:
        return [{"location": location, "job_count": count} for location, count in self.repository.location_counts(limit)]

    def salary_trends(self) -> dict:
        return self.repository.salary_summary()

    def most_requested_skills(self, limit: int = 20) -> list[dict]:
        descriptions = self.session.scalars(select(Job.description).where(Job.description.is_not(None)))
        counts: Counter[str] = Counter()
        for description in descriptions:
            text = description.lower()
            for skill in SKILL_TERMS:
                pattern = rf"(?<!\w){re.escape(skill)}(?!\w)"
                if re.search(pattern, text):
                    counts[skill] += 1
        return [{"skill": skill, "job_count": count} for skill, count in counts.most_common(limit)]
