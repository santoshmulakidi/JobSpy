from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from search.trust import score_trust
from storage.models import Base
from storage.repository import JobRepository


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_trust_score_rewards_verified_sources_and_flags_risky_language():
    session = make_session()
    repository = JobRepository(session)
    run = repository.create_search_run(
        search_term="Engineer",
        location="Remote",
        sites=["career_page"],
        results_wanted=10,
        started_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
    )
    trusted, risky = repository.upsert_jobs(
        [
            {
                "site": "career_page",
                "id": "trusted-1",
                "title": "Software Engineer",
                "company": "Acme",
                "location": "Remote",
                "job_url": "https://careers.example.com/jobs/trusted-1",
                "description": "Build APIs for a product engineering team.",
            },
            {
                "site": "unknown_board",
                "id": "risky-1",
                "title": "Remote Software Engineer",
                "company": "Unknown",
                "location": "Remote",
                "job_url": "https://example.net/risky-1",
                "description": "Contact us on Telegram. Equipment check and gift card reimbursement required.",
            },
        ],
        run,
    )

    trusted_score = score_trust(trusted)
    risky_score = score_trust(risky)

    assert trusted_score.trust_status == "Verified"
    assert risky_score.trust_status == "Risk"
    assert risky_score.trust_score < trusted_score.trust_score
    assert "asks to use Telegram" in risky_score.trust_reasons
