from collectors import CollectionRequest
from collectors.adzuna_collector import AdzunaCollector


class FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


def test_adzuna_collector_requires_credentials():
    result = AdzunaCollector(app_id=None, app_key=None).collect(
        CollectionRequest(search_term="developer", location="Dallas, TX", sites=["adzuna"])
    )

    assert result.jobs == []
    assert "JOB_INTELLIGENCE_ADZUNA_APP_ID" in result.errors[0]


def test_adzuna_collector_parses_jobs(monkeypatch):
    def fake_get(url, params, headers, timeout):
        assert "api.adzuna.com" in url
        assert params["what"] == ".NET Developer"
        assert params["where"] == "Remote"
        return FakeResponse(
            {
                "results": [
                    {
                        "id": "123",
                        "title": "Senior .NET Developer",
                        "company": {"display_name": "Acme"},
                        "location": {"display_name": "Remote"},
                        "description": "C# Azure role with sponsorship",
                        "redirect_url": "https://example.com/job",
                        "created": "2026-06-18T12:00:00Z",
                        "contract_type": "full_time",
                        "salary_min": 120000,
                        "salary_max": 150000,
                    }
                ]
            }
        )

    monkeypatch.setattr("collectors.adzuna_collector.requests.get", fake_get)

    result = AdzunaCollector(app_id="id", app_key="key").collect(
        CollectionRequest(search_term=".NET Developer", location="Remote", sites=["adzuna"])
    )

    job = result.jobs[0]
    assert job["site"] == "adzuna"
    assert job["id"] == "123"
    assert job["title"] == "Senior .NET Developer"
    assert job["company"] == "Acme"
    assert job["location"] == "Remote"
    assert job["job_type"] == "full_time"
    assert job["min_amount"] == 120000
    assert job["is_remote"] is True
