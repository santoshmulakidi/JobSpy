from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import UTC, date, datetime, timedelta

from storage.models import Base, ChangeType, JobChange, JobStatus
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
    assert repository.count_job_changes(run.id, ChangeType.NEW) == 1
    assert repository.count_job_changes(run.id, ChangeType.UPDATED) == 1


def test_profile_defaults_and_application_tracking():
    session = make_session()
    repository = JobRepository(session)
    profile = repository.get_profile()

    assert ".NET Developer" in profile.target_roles
    assert "H1B/TN/GC friendly" == profile.visa_need

    repository.update_profile(
        {
            "target_roles": ["Java Developer"],
            "skills": ["Java", "Spring Boot"],
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
        started_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
    )
    job = repository.upsert_jobs(
        [
            {
                "site": "linkedin",
                "id": "java-1",
                "title": "Senior Java Developer",
                "company": "Acme",
                "location": "Remote",
                "job_url": "https://example.com/java-1",
                "description": "Java Spring Boot role with H1B sponsorship available.",
            }
        ],
        run,
    )[0]

    application = repository.upsert_application(
        job_id=job.id,
        status="Applied",
        resume_text="resume",
        cover_letter_text="cover",
    )
    session.commit()

    assert repository.get_profile().target_roles == ["Java Developer"]
    assert application.job_id == job.id
    assert repository.get_application_for_job(job.id).resume_text == "resume"
    assert len(repository.list_applications()) == 1


def test_job_lifecycle_archives_old_jobs_deletes_expired_and_preserves_applied():
    session = make_session()
    repository = JobRepository(session)
    run = repository.create_search_run(
        search_term="Engineer",
        location="Remote",
        sites=["linkedin"],
        results_wanted=10,
        started_at=datetime.now(UTC),
    )
    fresh_job, old_job, expired_job, applied_job = repository.upsert_jobs(
        [
            {"site": "linkedin", "id": "fresh", "title": "Fresh Engineer", "company": "Acme"},
            {"site": "linkedin", "id": "old", "title": "Old Engineer", "company": "Acme"},
            {"site": "linkedin", "id": "expired", "title": "Expired Engineer", "company": "Acme"},
            {"site": "linkedin", "id": "applied", "title": "Applied Engineer", "company": "Acme"},
        ],
        run,
    )
    old_job.first_seen_at = datetime.now(UTC) - timedelta(days=2)
    expired_job.first_seen_at = datetime.now(UTC) - timedelta(days=8)
    applied_job.first_seen_at = datetime.now(UTC) - timedelta(days=8)
    repository.upsert_application(job_id=applied_job.id, status="Applied")
    session.commit()

    lifecycle = repository.apply_job_lifecycle(active_hours=24, retention_days=7)
    session.commit()

    assert lifecycle == {"archived": 2, "deleted": 1}
    assert repository.get_job(fresh_job.id).status == JobStatus.ACTIVE
    assert repository.get_job(old_job.id).status == JobStatus.ARCHIVED
    assert repository.get_job(expired_job.id) is None
    assert repository.get_job(applied_job.id).status == JobStatus.ARCHIVED
    assert repository.get_application_for_job(applied_job.id).status == "Applied"
    assert [job.title for job in repository.list_jobs()] == ["Fresh Engineer"]


def test_saved_searches_can_be_created_and_deleted():
    session = make_session()
    repository = JobRepository(session)

    saved_search = repository.create_saved_search(
        name="Remote Java",
        filters={"keyword": "Java", "location": "Remote", "limit": 100},
    )
    session.commit()

    assert repository.list_saved_searches()[0].name == "Remote Java"
    assert saved_search.filters["keyword"] == "Java"

    assert repository.delete_saved_search(saved_search.id) is True
    assert repository.delete_saved_search(saved_search.id) is False
    session.commit()
    assert repository.list_saved_searches() == []


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


def test_source_counts_returns_full_active_counts_by_source():
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
                "site": "linkedin",
                "id": "li-2",
                "title": "LinkedIn Architect",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/li-2",
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

    assert dict(repository.source_counts()) == {"linkedin": 2, "remotely": 1}


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


def test_job_computes_visa_score_and_apply_priority():
    session = make_session()
    repository = JobRepository(session)
    run = repository.create_search_run(
        search_term="Engineer",
        location="Remote",
        sites=["jobright_h1b"],
        results_wanted=10,
        started_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
    )

    repository.upsert_jobs(
        [
            {
                "site": "jobright_h1b",
                "id": "h1b-1",
                "title": "Backend Engineer",
                "company": "Sponsor Co",
                "location": "Remote",
                "job_url": "https://example.com/h1b-1",
                "date_posted": date.today(),
                "description": "H1B sponsor friendly team.",
            }
        ],
        run,
    )
    session.commit()

    job = repository.list_jobs()[0]
    assert job.visa_score == "High"
    assert job.apply_priority == "High"


def test_no_sponsorship_job_has_low_visa_score():
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
                "id": "low-visa",
                "title": "Hybrid Engineer",
                "company": "Acme",
                "location": "Dallas, TX",
                "job_url": "https://example.com/low-visa",
                "description": "This role does not offer employment sponsorship.",
            }
        ],
        run,
    )
    session.commit()

    job = repository.list_jobs()[0]
    assert job.visa_score == "Low"
    assert job.apply_priority == "Low"


def test_job_computes_remote_hybrid_and_onsite_work_modes():
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
                "id": "remote-mode",
                "title": "Remote Engineer",
                "company": "Remote Co",
                "location": "Remote",
                "job_url": "https://example.com/remote-mode",
                "is_remote": True,
            },
            {
                "site": "linkedin",
                "id": "hybrid-mode",
                "title": "Platform Engineer",
                "company": "Hybrid Co",
                "location": "Dallas, TX",
                "job_url": "https://example.com/hybrid-mode",
                "description": "Hybrid role with three days in office.",
            },
            {
                "site": "linkedin",
                "id": "onsite-mode",
                "title": "Systems Engineer",
                "company": "Office Co",
                "location": "Plano, TX",
                "job_url": "https://example.com/onsite-mode",
                "description": "Build distributed systems from the Plano office.",
            },
        ],
        run,
    )
    session.commit()

    modes = {job.source_job_id: job.work_mode for job in repository.list_jobs()}
    assert modes["remote-mode"] == "Remote"
    assert modes["hybrid-mode"] == "Hybrid"
    assert modes["onsite-mode"] == "On-site"


def test_list_jobs_filters_by_work_mode():
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
                "id": "hybrid-filter",
                "title": "Hybrid Engineer",
                "company": "Hybrid Co",
                "location": "Dallas, TX",
                "job_url": "https://example.com/hybrid-filter",
                "description": "Hybrid schedule.",
            },
            {
                "site": "linkedin",
                "id": "onsite-filter",
                "title": "Engineer",
                "company": "Office Co",
                "location": "Dallas, TX",
                "job_url": "https://example.com/onsite-filter",
            },
        ],
        run,
    )
    session.commit()

    jobs = repository.list_jobs(work_mode="Hybrid")
    assert len(jobs) == 1
    assert jobs[0].source_job_id == "hybrid-filter"
