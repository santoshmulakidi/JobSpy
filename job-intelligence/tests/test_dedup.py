from collectors.dedup import deduplicate_jobs, fingerprint_job


def test_fingerprint_prefers_source_and_url():
    first = fingerprint_job({"site": "linkedin", "job_url": "https://example.com/jobs/1"})
    second = fingerprint_job({"site": "linkedin", "job_url": "https://example.com/jobs/1"})
    assert first == second


def test_deduplicate_jobs_removes_duplicates():
    jobs = [
        {"site": "indeed", "job_url": "https://example.com/1", "title": "Engineer"},
        {"site": "indeed", "job_url": "https://example.com/1", "title": "Engineer"},
    ]
    assert len(deduplicate_jobs(jobs)) == 1
