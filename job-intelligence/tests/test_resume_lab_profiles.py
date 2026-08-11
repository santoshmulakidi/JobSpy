import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from storage.models import Base
from storage.database import get_session
from storage.repository import JobRepository, ResumeProfileConflict
from api.main import app


def make_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_profiles_are_seeded_and_resume_can_be_removed():
    session = make_session()
    repository = JobRepository(session)
    profiles = repository.list_resume_lab_profiles()
    assert [profile.name for profile in profiles] == [
        ".NET Developer", "Java Developer", "AI Engineer"
    ]

    profile = profiles[-1]
    saved = repository.save_resume_lab_resume(
        profile.id,
        resume_text="AI Engineer with Python, PyTorch, Azure, and production APIs." * 2,
        resume_filename="ai-engineer.txt",
        expected_source_version=0,
        only_if_empty=False,
    )
    assert saved.source_version == 1
    assert len(saved.resume_sha256) == 64

    cleared = repository.clear_resume_lab_resume(
        profile.id, expected_source_version=1
    )
    assert cleared.name == "AI Engineer"
    assert cleared.resume_text is None
    assert cleared.resume_filename is None
    assert cleared.source_version == 2


def test_migration_never_overwrites_existing_vm_resume():
    session = make_session()
    repository = JobRepository(session)
    profile = repository.list_resume_lab_profiles()[0]
    repository.save_resume_lab_resume(
        profile.id,
        resume_text="VM resume " * 10,
        resume_filename="vm.txt",
        expected_source_version=0,
        only_if_empty=False,
    )

    with pytest.raises(ResumeProfileConflict):
        repository.save_resume_lab_resume(
            profile.id,
            resume_text="Browser resume " * 10,
            resume_filename="browser.txt",
            expected_source_version=1,
            only_if_empty=True,
        )


def test_stale_source_version_is_rejected():
    session = make_session()
    repository = JobRepository(session)
    profile = repository.list_resume_lab_profiles()[0]
    with pytest.raises(ResumeProfileConflict):
        repository.clear_resume_lab_resume(profile.id, expected_source_version=9)


def test_profile_api_saves_and_removes_only_resume():
    session = make_session()

    def override_session():
        yield session

    app.dependency_overrides[get_session] = override_session
    try:
        client = TestClient(app)
        profile = next(
            item for item in client.get("/resume-lab/profiles").json()
            if item["name"] == "AI Engineer"
        )
        response = client.put(
            f"/resume-lab/profiles/{profile['id']}/resume",
            json={
                "resume_text": "AI Engineer with Python and Azure. " * 3,
                "resume_filename": "ai.txt",
                "expected_source_version": 0,
                "only_if_empty": False,
            },
        )
        assert response.status_code == 200
        assert response.json()["source_version"] == 1

        removed = client.delete(
            f"/resume-lab/profiles/{profile['id']}/resume",
            params={"expected_source_version": 1},
        )
        assert removed.status_code == 200
        assert removed.json()["name"] == "AI Engineer"
        assert removed.json()["resume_text"] is None
    finally:
        app.dependency_overrides.clear()
