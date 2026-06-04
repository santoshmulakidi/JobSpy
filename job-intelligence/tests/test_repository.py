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


def test_visa_status_prioritizes_no_sponsorship_phrases():
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
                "id": "no-sponsor-1",
                "title": "Software Architect",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/no-sponsor-1",
                "description": "This role is not eligible for Visa sponsorship, including H-1B, TN, L1, and OPT.",
            },
            {
                "site": "indeed",
                "id": "no-sponsor-2",
                "title": "Cloud Engineer",
                "company": "Gamma",
                "location": "Dallas, TX",
                "job_url": "https://example.com/no-sponsor-2",
                "description": "At this time, we are unable to offer employment sponsorship for this position. This includes H-1B, TN, L1, and OPT visa types.",
            },
            {
                "site": "indeed",
                "id": "sponsor-1",
                "title": "Software Engineer II",
                "company": "Beta",
                "location": "Dallas, TX",
                "job_url": "https://example.com/sponsor-1",
                "description": "Limited immigration sponsorship may be available.",
            },
        ],
        run,
    )
    session.commit()

    statuses = {job.source_job_id: job.visa_status for job in repository.list_jobs()}
    assert statuses["no-sponsor-1"] == "No sponsorship"
    assert statuses["no-sponsor-2"] == "No sponsorship"
    assert statuses["sponsor-1"] == "Sponsorship available"


def test_visa_status_does_not_treat_state_abbreviation_as_tn_visa():
    session = make_session()
    repository = JobRepository(session)
    run = repository.create_search_run(
        search_term="Engineer",
        location="Tennessee",
        sites=["indeed"],
        results_wanted=10,
        started_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
    )

    repository.upsert_jobs(
        [
            {
                "site": "indeed",
                "id": "tn-state-1",
                "title": "Workday Consultant",
                "company": "Acme",
                "location": "Nashville, TN",
                "job_url": "https://example.com/tn-state-1",
                "description": "This is a hybrid role in Nashville, TN and will require 3 days per week in the office.",
            }
        ],
        run,
    )
    session.commit()

    job = repository.list_jobs()[0]
    assert job.visa_status == "Not specified"


def test_list_jobs_filters_by_visa_status():
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
                "id": "w2-1",
                "title": "Senior Dotnet Developer Only W2",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/w2-1",
            },
            {
                "site": "indeed",
                "id": "open-1",
                "title": "Senior Dotnet Developer",
                "company": "Beta",
                "location": "Dallas, TX",
                "job_url": "https://example.com/open-1",
            },
        ],
        run,
    )
    session.commit()

    jobs = repository.list_jobs(visa_status="W2 only")
    assert len(jobs) == 1
    assert jobs[0].source_job_id == "w2-1"


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


def test_list_jobs_orders_by_latest_posting_date():
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
                "id": "old",
                "title": "Old Engineer",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/old",
                "date_posted": date(2026, 1, 1),
            },
            {
                "site": "indeed",
                "id": "new",
                "title": "New Engineer",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/new",
                "date_posted": date(2026, 6, 1),
            },
        ],
        run,
    )
    session.commit()

    jobs = repository.list_jobs()
    assert [job.source_job_id for job in jobs] == ["new", "old"]


def test_list_jobs_filters_fulltime_job_type():
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
                "id": "fulltime",
                "title": "Full Time Engineer",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/fulltime",
                "job_type": "fulltime",
            },
            {
                "site": "indeed",
                "id": "contract",
                "title": "Contract Engineer",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/contract",
                "job_type": "contract",
            },
        ],
        run,
    )
    session.commit()

    jobs = repository.list_jobs(job_type="fulltime")
    assert len(jobs) == 1
    assert jobs[0].source_job_id == "fulltime"
