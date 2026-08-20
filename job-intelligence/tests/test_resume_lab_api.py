from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from ai.resume_orchestrator import GenerationEvent, OrchestrationResult
from api.main import app
from api.schemas import CoverLetterResponse
from storage.database import get_session
from storage.models import Base
from storage.repository import JobRepository


def test_generation_is_cached_for_identical_inputs(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    repository = JobRepository(session)
    profile = repository.list_resume_lab_profiles()[0]
    repository.save_resume_lab_resume(
        profile.id, resume_text="Senior engineer with Python and Azure. " * 3,
        resume_filename="resume.txt", expected_source_version=0, only_if_empty=False,
    )
    session.commit()
    calls = []

    def fake_orchestrate(request, settings):
        calls.append(request)
        return OrchestrationResult(
            status="REVIEWED", resume_text="Generated AI Engineer resume " * 3,
            ats_score=87, attempts=1,
            events=[GenerationEvent("ATS_TARGET_REACHED", "info", "ats", "openrouter", "qwen", 1, datetime.now(UTC).isoformat(), "87")],
        )

    monkeypatch.setattr("api.main.orchestrate_resume", fake_orchestrate)

    def override_session():
        yield session

    app.dependency_overrides[get_session] = override_session
    try:
        client = TestClient(app)
        payload = {
            "profile_id": profile.id, "source_version": 1, "mode": "IMPORTANT",
            "job_description": "AI Engineer requires Python and Azure experience. " * 2,
            "target_title": "AI Engineer", "company_name": "Example",
            "idempotency_key": "first-request-0001",
        }
        first = client.post("/resume-lab/generate", json=payload)
        second = client.post("/resume-lab/generate", json={**payload, "idempotency_key": "second-request-0002"})
        assert first.status_code == second.status_code == 200
        assert second.json()["run_id"] == first.json()["run_id"]
        assert second.json()["cache_hit"] is True
        assert len(calls) == 1

        cover_calls = []
        def fake_cover(**kwargs):
            cover_calls.append(kwargs)
            return CoverLetterResponse(provider="gemini (key 1)", model="gemini-test", cover_letter="Dear Hiring Manager")
        monkeypatch.setattr("api.main._gemini_cover_letter_from_run", fake_cover)
        cover_payload = {
            "run_id": first.json()["run_id"],
            "job_description": payload["job_description"],
            "target_title": payload["target_title"],
            "company_name": payload["company_name"],
        }
        cover = client.post("/resume-lab/cover-letter", json=cover_payload)
        assert cover.status_code == 200
        assert "Generated AI Engineer resume" in cover_calls[0]["generated_resume"]

        changed = client.post(
            "/resume-lab/cover-letter", json={**cover_payload, "company_name": "Changed"}
        )
        assert changed.status_code == 409
        assert len(cover_calls) == 1
    finally:
        app.dependency_overrides.clear()


def test_refine_endpoint_serializes_successful_events(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    repository = JobRepository(session)
    profile = repository.list_resume_lab_profiles()[0]
    source_resume = "Senior engineer with Python, Azure, APIs, and testing experience. " * 3
    repository.save_resume_lab_resume(
        profile.id,
        resume_text=source_resume,
        resume_filename="resume.txt",
        expected_source_version=0,
        only_if_empty=False,
    )
    session.commit()

    def fake_refine(request, settings):
        return OrchestrationResult(
            status="REVIEWED",
            resume_text="Refined senior engineer resume with Python and Azure. " * 3,
            events=[
                GenerationEvent(
                    "REFINE_SUCCEEDED",
                    "info",
                    "refine",
                    "omniroute",
                    "claude-test",
                    1,
                    datetime.now(UTC).isoformat(),
                    "Refinement completed",
                )
            ],
        )

    monkeypatch.setattr("api.main.refine_resume", fake_refine)

    def override_session():
        yield session

    app.dependency_overrides[get_session] = override_session
    try:
        response = TestClient(app).post(
            "/resume-lab/refine",
            json={
                "profile_id": profile.id,
                "current_resume": source_resume,
                "job_description": "Senior AI Engineer requires Python, Azure, APIs, and testing. " * 2,
                "target_title": "Senior AI Engineer",
                "instruction": "Tighten the summary.",
            },
        )

        assert response.status_code == 200
        assert response.json()["status"] == "REVIEWED"
        assert response.json()["events"][0]["code"] == "REFINE_SUCCEEDED"
    finally:
        app.dependency_overrides.clear()
