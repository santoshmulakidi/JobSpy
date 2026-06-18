from collectors import CollectionRequest
from collectors.remoteok_collector import RemoteOKCollector


class FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


def test_remoteok_collector_parses_jobs(monkeypatch):
    def fake_get(url, headers, timeout):
        assert url == "https://remoteok.com/api"
        return FakeResponse(
            [
                {"legal": "ignored"},
                {
                    "id": "abc",
                    "position": "Senior .NET Developer",
                    "company": "Acme",
                    "location": "USA",
                    "description": "C# Azure remote job",
                    "url": "https://remoteok.com/remote-jobs/abc",
                    "date": "2026-06-18T12:00:00+00:00",
                    "tags": ["c#", ".net", "azure"],
                    "salary_min": 100000,
                    "salary_max": 140000,
                },
            ]
        )

    monkeypatch.setattr("collectors.remoteok_collector.requests.get", fake_get)

    result = RemoteOKCollector().collect(
        CollectionRequest(search_term=".NET Azure", location="United States", sites=["remoteok"])
    )

    job = result.jobs[0]
    assert job["site"] == "remoteok"
    assert job["id"] == "abc"
    assert job["title"] == "Senior .NET Developer"
    assert job["company"] == "Acme"
    assert job["is_remote"] is True
    assert "azure" in job["description"].lower()
