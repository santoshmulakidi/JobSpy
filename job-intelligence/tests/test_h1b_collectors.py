from collectors import CollectionRequest
from collectors.markdown_job_collector import MarkdownJobCollector
from collectors.simple_web_job_collector import SimpleWebJobCollector


def test_markdown_collector_extracts_h1b_table_row():
    markdown = """
| Company | Job Title | Location | H1B Status | Link | Date Posted |
| --- | --- | --- | --- | --- | --- |
| Acme | Senior Developer | Dallas, TX | H1B Sponsor Likely | [Apply](https://acme.test/job/1) | 2026-06-03 |
"""

    collector = MarkdownJobCollector(
        source_name="jobright_h1b",
        source_url="https://example.test/jobs.md",
        visa_friendly=True,
    )
    jobs = collector._parse_markdown(
        markdown,
        CollectionRequest(search_term="developer", sites=["jobright_h1b"]),
    )

    assert jobs[0]["site"] == "jobright_h1b"
    assert jobs[0]["company"] == "Acme"
    assert jobs[0]["job_url"] == "https://acme.test/job/1"
    assert jobs[0]["raw"]["h1b_status"] == "H1B Sponsor Likely"


def test_markdown_collector_tries_fallback_urls(monkeypatch):
    calls = []

    class FakeResponse:
        def __init__(self, text="", ok=True):
            self.text = text
            self.ok = ok

        def raise_for_status(self):
            if not self.ok:
                import requests

                raise requests.HTTPError("404")

    def fake_get(url, **kwargs):
        calls.append(url)
        if url.endswith("/main/README.md"):
            return FakeResponse(ok=False)
        return FakeResponse(
            """
| Company | Job Title | Location | H1B status | Link | Date Posted |
| --- | --- | --- | --- | --- | --- |
| Acme | Developer | Remote | 🏅 | [apply](https://acme.test/job/2) | 2026-06-03 |
"""
        )

    monkeypatch.setattr("collectors.markdown_job_collector.requests.get", fake_get)
    collector = MarkdownJobCollector(
        source_name="jobright_h1b",
        source_url="https://raw.githubusercontent.com/jobright-ai/Daily-H1B-Jobs-In-Tech/main/README.md",
        fallback_urls=[
            "https://raw.githubusercontent.com/jobright-ai/Daily-H1B-Jobs-In-Tech/master/README.md"
        ],
    )

    result = collector.collect(CollectionRequest(search_term="developer", sites=["jobright_h1b"]))

    assert calls == [
        "https://raw.githubusercontent.com/jobright-ai/Daily-H1B-Jobs-In-Tech/main/README.md",
        "https://raw.githubusercontent.com/jobright-ai/Daily-H1B-Jobs-In-Tech/master/README.md",
    ]
    assert result.errors == []
    assert result.jobs[0]["job_url"] == "https://acme.test/job/2"


def test_simple_web_collector_extracts_job_links():
    html = """
<section>
  <a href="/jobs/software-developer">Software Developer</a>
  <span>Acme Tech · Dallas, TX · H1B sponsorship</span>
</section>
"""
    collector = SimpleWebJobCollector(
        source_name="dice",
        search_url_template="https://dice.test/jobs?q={query}&location={location}",
    )

    jobs = collector._parse_jobs(
        html,
        CollectionRequest(search_term="developer", location="Dallas, TX", sites=["dice"]),
        "https://dice.test/jobs?q=developer",
    )

    assert jobs[0]["site"] == "dice"
    assert jobs[0]["job_url"] == "https://dice.test/jobs/software-developer"
