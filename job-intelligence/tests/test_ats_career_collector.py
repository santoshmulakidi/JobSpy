from collectors import CollectionRequest
from collectors.ats_career_collector import AtsCareerPageCollector


def test_greenhouse_collector_uses_board_api(monkeypatch):
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "jobs": [
                    {
                        "id": 123,
                        "title": "Senior Developer",
                        "absolute_url": "https://boards.greenhouse.io/acme/jobs/123",
                        "location": {"name": "Remote"},
                        "content": "<p>Build platforms. H1B sponsorship available.</p>",
                        "updated_at": "2026-06-03T10:00:00Z",
                    }
                ]
            }

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse()

    monkeypatch.setattr("collectors.ats_career_collector.requests.get", fake_get)
    collector = AtsCareerPageCollector()

    jobs = collector._collect_target(
        {"rank": 1, "company": "Acme", "career_url": "https://boards.greenhouse.io/acme"},
        CollectionRequest(search_term="developer", sites=["career_page"]),
    )

    assert calls == ["https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true"]
    assert jobs[0]["site"] == "career_page"
    assert jobs[0]["company"] == "Acme"
    assert jobs[0]["raw"]["ats"] == "greenhouse"


def test_lever_collector_uses_postings_api(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return [
                {
                    "id": "abc",
                    "text": "Full Stack Developer",
                    "hostedUrl": "https://jobs.lever.co/acme/abc",
                    "descriptionPlain": "Developer role",
                    "additionalPlain": "Remote friendly",
                    "createdAt": 1770000000000,
                    "categories": {"location": "Remote", "commitment": "Full-time"},
                }
            ]

    monkeypatch.setattr("collectors.ats_career_collector.requests.get", lambda *args, **kwargs: FakeResponse())
    collector = AtsCareerPageCollector()

    jobs = collector._collect_target(
        {"rank": 1, "company": "Acme", "career_url": "https://jobs.lever.co/acme"},
        CollectionRequest(search_term="developer", sites=["career_page"], job_type="fulltime"),
    )

    assert jobs[0]["title"] == "Full Stack Developer"
    assert jobs[0]["raw"]["ats"] == "lever"
    assert jobs[0]["is_remote"] is True
