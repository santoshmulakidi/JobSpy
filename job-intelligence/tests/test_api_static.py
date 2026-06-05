from fastapi.testclient import TestClient

from api.main import app


def test_local_dashboard_is_served():
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "Job Intelligence Platform" in response.text
    assert "data-theme=\"amethyst\"" in response.text
    assert "theme-switcher" in response.text
    assert "Visa status" in response.text
    assert "High visa score" in response.text
    assert "Latest jobs" in response.text
    assert "Source health" in response.text
    assert "Company targets" in response.text
    assert "All latest" in response.text
    assert "Hybrid" in response.text
    assert "On-site" in response.text
    assert "Hourly refresh" in response.text
    assert "Start hourly refresh" in response.text
    assert "Select all sources" in response.text
    assert "Deselect all" in response.text
    assert "Any visa status" in response.text
    assert "Full-time" in response.text
    assert "Job type" in response.text
    assert "collectJobType" in response.text
    assert "Run latest" in response.text
    assert "Last 30 minutes" in response.text
    assert "Last 2 hours" in response.text
    assert "LinkedIn companies" in response.text
    assert "Visa-friendly sources" in response.text
    assert "LinkedIn only" in response.text
    assert "Last 7 days" in response.text
    assert "useCompanyTargets" in response.text
    assert "Search keywords" in response.text
    assert ".NET developer, Java developer, data engineer" in response.text
    assert "Dallas, TX, Remote, or United States" in response.text
    assert "Company list limit" not in response.text
    assert "companyTargetLimit" not in response.text
    assert "visaFriendlyOnly" in response.text
    assert "Career Pages" in response.text
    assert "Jobright H1B" in response.text
    assert "Simplify New Grad" in response.text
    assert "GitHub Internships" in response.text
    assert "Dice" in response.text
    assert "GovernmentJobs" in response.text
    assert "USAJOBS" in response.text
    assert "API key needed" in response.text
    assert "verified" in response.text
    assert "no parse" in response.text
    assert "Verified sources returned jobs" in response.text
    assert "JobsH1B" in response.text
    assert "VisaFriendly" in response.text
    assert "Glever" in response.text
    assert "JobsGrep" in response.text
    assert "HiringCafe" in response.text
    assert "Wellfound" in response.text
    assert "YC Jobs" in response.text
    assert "College Recruiter" in response.text
    assert ".NET developer or Java developer" in response.text
    assert "CareerBuilder" in response.text
    assert "blocked" in response.text
    assert "Remotely.jobs" in response.text
    assert "We Work Remotely" in response.text
    assert "minSalaryInput" not in response.text
    assert "maxSalaryInput" not in response.text


def test_static_assets_are_served():
    client = TestClient(app)

    response = client.get("/static/app.js")

    assert response.status_code == 200
    assert "loadData" in response.text
    assert "H1B accepted" in response.text
    assert "supportedSources" in response.text
    assert "jobright_h1b" in response.text
    assert "governmentjobs" in response.text
    assert "usajobs_api" in response.text
    assert "sourceHealthGrid" in response.text
    assert "companyTargetsGrid" in response.text
    assert "visa_score" in response.text
    assert "apply_priority" in response.text
    assert "work_mode" in response.text
    assert "setWorkMode" in response.text
    assert "startHourlyRefresh" in response.text
    assert "setAllSources" in response.text
    assert "selectAllSourcesButton" in response.text
    assert "/scheduler/status" in response.text
    assert "job-intelligence-theme" in response.text
    assert "data-theme-button" in response.text
    assert "applyLinkedInLatestPreset" in response.text
    assert "collectLinkedInLatest" in response.text
    assert "collectSelectedLinkedInLatest" in response.text
    assert "collectLinkedInCompanyTargets" in response.text
    assert "collectVisaFriendlyCompanies" in response.text
    assert "data-job-details-id" in response.text
    assert "data-job-card-id" in response.text
    assert "toggleInlineDetails" in response.text
    assert "inline-job-details" in response.text
    assert "/stats" in response.text
    assert "/source-counts" in response.text
    assert "New jobs added" in response.text
    assert "centralDateTime" in response.text
    assert "America/Chicago" in response.text
    assert "postingTimestamp" in response.text
    assert "United States" in response.text
    assert "min_salary:" not in response.text
    assert "max_salary:" not in response.text


def test_admin_dashboard_is_served():
    client = TestClient(app)

    response = client.get("/admin")

    assert response.status_code == 200
    assert "Total Users" in response.text
    assert "Traffic by Channel" in response.text
    assert "Quick Invite" in response.text
    assert "data-theme=\"amethyst\"" in response.text
    assert "theme-switcher" in response.text
    assert "/static/admin.css" in response.text
    assert "/static/admin.js" in response.text


def test_admin_css_uses_design_tokens():
    client = TestClient(app)

    response = client.get("/static/admin.css")

    assert response.status_code == 200
    assert "--primary: #7f77dd" in response.text
    assert "--sidebar-width: 220px" in response.text
    assert "border-right: 0.5px solid var(--hairline)" in response.text
    assert "backdrop-filter: var(--blur)" in response.text


def test_admin_theme_script_is_served():
    client = TestClient(app)

    response = client.get("/static/admin.js")

    assert response.status_code == 200
    assert "data-theme-button" in response.text
    assert "localStorage" in response.text


def test_refresh_endpoint_is_registered():
    paths = {route.path for route in app.routes}

    assert "/refresh" in paths
    assert "/stats" in paths
    assert "/source-counts" in paths
    assert "/company-targets" in paths
    assert "/scheduler/status" in paths
    assert "/scheduler/start" in paths
    assert "/scheduler/stop" in paths


def test_company_targets_endpoint_returns_document_companies():
    client = TestClient(app)

    response = client.get("/company-targets?limit=3")

    assert response.status_code == 200
    targets = response.json()
    assert len(targets) == 3
    assert targets[0]["company"] == "Amazon / AWS"
    assert targets[0]["career_url"] == "https://www.amazon.jobs/"


def test_company_targets_endpoint_includes_added_product_companies():
    client = TestClient(app)

    response = client.get("/company-targets?limit=500")

    assert response.status_code == 200
    companies = {target["company"] for target in response.json()}
    assert "Roku" in companies
    assert "Pinterest" in companies
    assert "MongoDB" in companies
    assert "The Trade Desk" in companies
    assert "Fifth Third Bank" in companies
    assert "WHOOP" in companies
    assert "Skydio" in companies
