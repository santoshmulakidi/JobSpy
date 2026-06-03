from collectors import CollectionRequest
from collectors.careerbuilder_collector import CareerBuilderCollector


def test_careerbuilder_parser_extracts_basic_job():
    html = """
    <html><body>
      <article>
        <a href="/job/J3N123">Senior .NET Developer</a>
        <p>Acme Corp - Dallas, TX</p>
      </article>
    </body></html>
    """
    collector = CareerBuilderCollector()

    jobs = collector._parse_jobs(
        html,
        CollectionRequest(
            search_term="Senior .NET Developer",
            location="Dallas, TX",
            sites=["careerbuilder"],
        ),
        "https://www.careerbuilder.com/jobs",
    )

    assert jobs[0]["site"] == "careerbuilder"
    assert jobs[0]["title"] == "Senior .NET Developer"
    assert jobs[0]["job_url"] == "https://www.careerbuilder.com/job/J3N123"


def test_careerbuilder_reports_blocked_response(monkeypatch):
    class FakeResponse:
        status_code = 403
        url = "https://www.careerbuilder.com/"
        text = "Please enable JS"

    def fake_get(*args, **kwargs):
        return FakeResponse()

    monkeypatch.setattr("collectors.careerbuilder_collector.requests.get", fake_get)

    result = CareerBuilderCollector().collect(
        CollectionRequest(
            search_term="Senior .NET Developer",
            location="Dallas, TX",
            sites=["careerbuilder"],
        )
    )

    assert result.jobs == []
    assert "JavaScript challenge" in result.errors[0]
    assert "browser-assisted" in result.errors[0]
