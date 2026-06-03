from collectors import CollectionRequest
from collectors.remotely_collector import RemotelyJobsCollector
from collectors.weworkremotely_collector import WeWorkRemotelyCollector


def test_remotely_parser_extracts_job_card():
    html = """
    <article class="job-card-horizontal">
      <a href="https://www.remotely.jobs/show/abc123">
        <span class="job-title">Senior .NET Developer</span>
      </a>
      <span class="company-name">Acme Remote</span>
      <span class="job-meta">United States 3 days ago</span>
      <p class="job-description">Build remote software platforms.</p>
    </article>
    """

    jobs = RemotelyJobsCollector()._parse_jobs(
        html,
        CollectionRequest(search_term=".NET", location="United States", sites=["remotely"]),
        "https://www.remotely.jobs/search?query=.NET",
    )

    assert jobs[0]["site"] == "remotely"
    assert jobs[0]["title"] == "Senior .NET Developer"
    assert jobs[0]["company"] == "Acme Remote"
    assert jobs[0]["is_remote"] is True


def test_weworkremotely_reports_cloudflare_challenge(monkeypatch):
    class FakeResponse:
        status_code = 403
        url = "https://weworkremotely.com/remote-jobs/search?term=.NET"
        text = "Just a moment..."

    def fake_get(*args, **kwargs):
        return FakeResponse()

    monkeypatch.setattr("collectors.weworkremotely_collector.requests.get", fake_get)

    result = WeWorkRemotelyCollector().collect(
        CollectionRequest(search_term=".NET", location=None, sites=["weworkremotely"])
    )

    assert result.jobs == []
    assert "Cloudflare challenge" in result.errors[0]
