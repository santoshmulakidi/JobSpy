from collectors import CollectionRequest
from collectors.governmentjobs_collector import GovernmentJobsCollector


def test_governmentjobs_collector_parses_job_cards():
    html = """
    <ul class="unstyled job-listing-container">
      <li class="job-item" data-job-id="5253865-0">
        <a class="job-details-link" href="/jobs/5253865-0/software-developer">Software Developer</a>
        <div class="primaryInfo job-organization">Administrative Office of the Courts</div>
        <div class="primaryInfo"><span class="job-location">Olympia, WA</span></div>
      </li>
      <li class="job-item" data-job-id="5362023-0">
        <a class="job-details-link" href="/jobs/5362023-0/journey-it-application-developer">Journey IT Application Developer</a>
        <div class="primaryInfo job-organization">State of Washington</div>
        <div class="primaryInfo"><span class="job-location">Thurston County - Olympia, WA</span> - Flexible/Hybrid</div>
      </li>
    </ul>
    """
    collector = GovernmentJobsCollector()

    jobs = collector._parse_jobs(
        html,
        CollectionRequest(search_term="developer", sites=["governmentjobs"], location="United States"),
        "https://www.governmentjobs.com/jobs?keyword=developer",
    )

    assert len(jobs) == 2
    assert jobs[0]["site"] == "governmentjobs"
    assert jobs[0]["title"] == "Software Developer"
    assert jobs[0]["company"] == "Administrative Office of the Courts"
    assert jobs[0]["location"] == "Olympia, WA"
    assert jobs[0]["job_url"] == "https://www.governmentjobs.com/jobs/5253865-0/software-developer"
    assert jobs[1]["company"] == "State of Washington"
