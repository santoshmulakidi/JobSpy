from datetime import UTC, datetime

from api.main import process_ai_generation_job
from api.schemas import CoverLetterResponse
from ai.resume_rebuilder import ResumeRebuildResult
from storage.models import AIGenerationStatus
from storage.repository import JobRepository
from tests.test_repository import make_session


def test_process_generation_job_fetches_missing_jd_and_saves_resume_and_cover_letter(monkeypatch):
    session = make_session()
    repository = JobRepository(session)
    run = repository.create_search_run(
        search_term=".NET",
        location="Remote",
        sites=["linkedin"],
        results_wanted=10,
        started_at=datetime.now(UTC),
    )
    job = repository.upsert_jobs(
        [
            {
                "site": "linkedin",
                "id": "worker-1",
                "title": "Senior .NET Developer",
                "company": "Contoso",
                "location": "Remote",
                "job_url": "https://example.com/worker-1",
            }
        ],
        run,
    )[0]
    queued = repository.enqueue_ai_generation_jobs(
        job_ids=[job.id],
        generation_type="both",
        base_resume="Senior .NET Developer with Azure, C#, ASP.NET Core, and SQL Server experience.",
        profile_name=".NET Developer",
        provider="gemini",
        model="gemini-2.5-flash",
    )[0]
    session.commit()

    monkeypatch.setattr(
        "api.main._fetch_job_description_from_url",
        lambda url: "Build ASP.NET Core APIs on Azure with SQL Server, CI/CD, and React.",
    )

    def fake_rebuild_resume(**kwargs):
        assert "ASP.NET Core APIs" in kwargs["job_description"]
        return ResumeRebuildResult(
            provider="gemini",
            model="gemini-2.5-flash",
            rebuilt_resume="Tailored resume for Contoso",
            change_summary=[],
            warnings=[],
            prompt="resume prompt",
        )

    def fake_cover_letter(**kwargs):
        assert kwargs["company_name"] == "Contoso"
        return CoverLetterResponse(
            provider="gemini",
            model="gemini-2.5-flash",
            cover_letter="Cover letter for Contoso",
        )

    monkeypatch.setattr("api.main.rebuild_resume", fake_rebuild_resume)
    monkeypatch.setattr("api.main._generate_cover_letter_text", fake_cover_letter)

    process_ai_generation_job(session, queued.id)

    processed = repository.list_ai_generation_jobs()[0]
    documents = repository.get_job_documents(job.id)
    assert processed.status == AIGenerationStatus.COMPLETED
    assert repository.get_job(job.id).description.startswith("Build ASP.NET Core APIs")
    assert documents["resume_versions"][0].content_text == "Tailored resume for Contoso"
    assert documents["cover_letter_versions"][0].content_text == "Cover letter for Contoso"
