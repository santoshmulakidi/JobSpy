from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import date

from storage.models import Base, ChangeType, JobChange
from storage.repository import JobRepository


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_upsert_creates_and_updates_job_changes():
    session = make_session()
    repository = JobRepository(session)
    run = repository.create_search_run(
        search_term="Engineer",
        location="Texas",
        sites=["linkedin"],
        results_wanted=10,
        started_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
    )
    repository.upsert_jobs(
        [
            {
                "site": "linkedin",
                "id": "123",
                "title": "Software Engineer",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/123",
            }
        ],
        run,
    )
    session.commit()

    repository.upsert_jobs(
        [
            {
                "site": "linkedin",
                "id": "123",
                "title": "Senior Software Engineer",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/123",
            }
        ],
        run,
    )
    session.commit()

    jobs = repository.list_jobs(keyword="Senior")
    changes = session.query(JobChange).order_by(JobChange.id).all()
    assert len(jobs) == 1
    assert [change.change_type for change in changes] == [ChangeType.NEW, ChangeType.UPDATED]


def test_upsert_sanitizes_change_history_json():
    session = make_session()
    repository = JobRepository(session)
    run = repository.create_search_run(
        search_term="Engineer",
        location="Texas",
        sites=["indeed"],
        results_wanted=10,
        started_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
    )

    repository.upsert_jobs(
        [
            {
                "site": "indeed",
                "id": "456",
                "title": "Platform Engineer",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/456",
                "date_posted": date(2026, 6, 2),
                "min_amount": float("nan"),
            }
        ],
        run,
    )
    session.commit()

    change = session.query(JobChange).one()
    assert change.after["date_posted"] == "2026-06-02"
    assert change.after["raw"]["min_amount"] is None


def test_job_computes_visa_status_from_description():
    session = make_session()
    repository = JobRepository(session)
    run = repository.create_search_run(
        search_term="Engineer",
        location="Texas",
        sites=["linkedin"],
        results_wanted=10,
        started_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
    )

    repository.upsert_jobs(
        [
            {
                "site": "linkedin",
                "id": "789",
                "title": "Software Engineer",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/789",
                "description": "Candidates must be US Citizen, Green Card, or GC eligible.",
            }
        ],
        run,
    )
    session.commit()

    job = repository.list_jobs()[0]
    assert job.visa_status == "USC/GC required"


def test_list_jobs_filters_by_source():
    session = make_session()
    repository = JobRepository(session)
    run = repository.create_search_run(
        search_term="Engineer",
        location="Remote",
        sites=["linkedin", "remotely"],
        results_wanted=10,
        started_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
    )

    repository.upsert_jobs(
        [
            {
                "site": "linkedin",
                "id": "li-1",
                "title": "LinkedIn Engineer",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/li-1",
            },
            {
                "site": "remotely",
                "id": "remote-1",
                "title": "Remote Engineer",
                "company": "Remote Co",
                "location": "Remote",
                "job_url": "https://example.com/remote-1",
            },
        ],
        run,
    )
    session.commit()

    jobs = repository.list_jobs(source="remotely")
    assert len(jobs) == 1
    assert jobs[0].source == "remotely"
