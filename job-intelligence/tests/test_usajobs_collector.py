from collectors import CollectionRequest
from collectors.usajobs_collector import USAJobsCollector


def test_usajobs_collector_requires_credentials():
    collector = USAJobsCollector()

    result = collector.collect(
        CollectionRequest(search_term="developer", location="United States", sites=["usajobs_api"])
    )

    assert result.jobs == []
    assert "JOB_INTELLIGENCE_USAJOBS_API_KEY" in result.errors[0]


def test_usajobs_collector_parses_api_results():
    collector = USAJobsCollector(api_key="key", user_agent="test@example.com")
    payload = {
        "SearchResult": {
            "SearchResultItems": [
                {
                    "MatchedObjectDescriptor": {
                        "PositionID": "ABC123",
                        "PositionTitle": "IT Specialist",
                        "PositionURI": "https://www.usajobs.gov/job/ABC123",
                        "ApplyURI": ["https://apply.usastaffing.gov/ABC123"],
                        "OrganizationName": "Department of Test",
                        "PositionLocation": [{"LocationName": "Anywhere in the U.S."}],
                        "PositionSchedule": [{"Name": "Full-time"}],
                        "PublicationStartDate": "2026-06-05T00:00:00",
                        "UserArea": {"Details": {"JobSummary": "Remote software role"}},
                    }
                }
            ]
        }
    }

    jobs = collector._parse_jobs(
        payload,
        CollectionRequest(search_term="developer", location="United States", sites=["usajobs_api"]),
    )

    assert jobs[0]["site"] == "usajobs_api"
    assert jobs[0]["title"] == "IT Specialist"
    assert jobs[0]["company"] == "Department of Test"
    assert jobs[0]["location"] == "Anywhere in the U.S."
    assert jobs[0]["is_remote"] is True
