from datetime import UTC, datetime

from search import SearchEngine
from search.scoring import score_job
from tests.test_repository import make_session
from storage.repository import JobRepository


def test_backend_profile_scoring_and_qualified_filter():
    session = make_session()
    repository = JobRepository(session)
    repository.update_profile(
        {
            "target_roles": ["Java Developer"],
            "skills": ["Java", "Spring Boot", "AWS"],
            "preferred_locations": ["Remote"],
            "experience_level": "Senior",
            "visa_need": "H1B sponsorship required",
            "work_mode_preference": "Remote",
            "job_type_preference": "Full-time",
            "excluded_keywords": ["USC only"],
        }
    )
    run = repository.create_search_run(
        search_term="Java",
        location="Remote",
        sites=["linkedin"],
        results_wanted=10,
        started_at=datetime.now(UTC),
    )
    repository.upsert_jobs(
        [
            {
                "site": "linkedin",
                "id": "qualified",
                "title": "Senior Java Developer",
                "company": "Acme",
                "location": "Remote",
                "job_url": "https://example.com/qualified",
                "description": "Java Spring Boot AWS role. H1B sponsorship available.",
                "is_remote": True,
            },
            {
                "site": "linkedin",
                "id": "blocked",
                "title": "Software Engineer",
                "company": "Beta",
                "location": "Dallas, TX",
                "job_url": "https://example.com/blocked",
                "description": "USC only. No sponsorship.",
            },
        ],
        run,
    )
    session.commit()

    profile = repository.get_profile()
    jobs = repository.list_jobs()
    scores = {job.source_job_id: score_job(job, profile) for job in jobs}
    qualified = SearchEngine(session).search(qualification_status="Qualified")

    assert scores["qualified"].qualification_status == "Qualified"
    assert scores["qualified"].fit_score >= 55
    assert scores["blocked"].qualification_status == "Disqualified"
    assert [job.source_job_id for job in qualified] == ["qualified"]
