import pytest

from career_alerts.matching import match_job
from career_alerts.types import CareerJob


def job(title, location="Dallas, TX", description="", is_remote=False):
    return CareerJob(
        "greenhouse:acme",
        "greenhouse",
        "1",
        "Acme",
        ("Acme LLC",),
        title,
        location,
        description,
        "https://acme.test/jobs/1",
        None,
        is_remote,
    )


@pytest.mark.parametrize(
    ("candidate", "stream"),
    [
        (job("Senior .NET Developer"), "dotnet"),
        (job("Backend C# Engineer", description="ASP.NET Core APIs"), "dotnet"),
        (job("Applied AI Engineer", description="Python backend RAG APIs"), "ai_engineer"),
        (job("Software Engineer, AI", "Remote - US", "LLM platform", True), "ai_engineer"),
    ],
)
def test_matches_role_stream(candidate, stream):
    assert stream in match_job(candidate).streams


@pytest.mark.parametrize(
    "candidate",
    [
        job("Network Engineer"),
        job("AI Engineer", description="Java desktop application"),
        job(".NET Developer", location="London, UK"),
    ],
)
def test_rejects_false_positive_or_non_us(candidate):
    assert match_job(candidate) is None


def test_location_precedence_remote_then_dfw_then_other_us():
    assert match_job(job(".NET Developer", "Remote - United States", is_remote=True)).location_bucket == "Remote"
    assert match_job(job(".NET Developer", "Remote - U.S.", is_remote=True)).location_bucket == "Remote"
    assert match_job(job(".NET Developer", "Plano, TX")).location_bucket == "DFW Metro"
    assert match_job(job(".NET Developer", "Seattle, WA")).location_bucket == "Other USA"
