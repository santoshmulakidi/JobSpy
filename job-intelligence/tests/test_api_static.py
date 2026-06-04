from fastapi.testclient import TestClient

from api.main import app


def test_local_dashboard_is_served():
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "Job Intelligence Platform" in response.text
    assert "data-theme=\"amethyst\"" in response.text
    assert "theme-switcher" in response.text
    assert "Visa Status" in response.text
    assert "Any visa status" in response.text
    assert "Full-time" in response.text
    assert "Posted" in response.text
    assert "collectJobType" in response.text
    assert "LinkedIn Latest 30m" in response.text
    assert 'data-linkedin-latest-hours="0.5"' in response.text
    assert "LinkedIn Latest 24h" in response.text
    assert "LinkedIn Companies 24h" in response.text
    assert "Visa-Friendly Companies 24h" in response.text
    assert "Last 7 days" in response.text
    assert "useCompanyTargets" in response.text
    assert "companyTargetLimit" in response.text
    assert "visaFriendlyOnly" in response.text
    assert "Career Pages" in response.text
    assert "Jobright H1B" in response.text
    assert "Simplify New Grad" in response.text
    assert "GitHub Internships" in response.text
    assert "Dice" in response.text
    assert "Wellfound" in response.text
    assert "YC Jobs" in response.text
    assert "College Recruiter" in response.text
    assert "developer contract or full-time" in response.text
    assert "CareerBuilder" in response.text
    assert "blocked/experimental" in response.text
    assert "Remotely.jobs" in response.text
    assert "We Work Remotely" in response.text


def test_static_assets_are_served():
    client = TestClient(app)

    response = client.get("/static/app.js")

    assert response.status_code == 200
    assert "loadData" in response.text
    assert "H1B accepted" in response.text
    assert "supportedSources" in response.text
    assert "jobright_h1b" in response.text
    assert "job-intelligence-theme" in response.text
    assert "data-theme-button" in response.text
    assert "applyLinkedInLatestPreset" in response.text
    assert "collectLinkedInLatest" in response.text
    assert "collectLinkedInCompanyTargets" in response.text
    assert "collectVisaFriendlyCompanies" in response.text


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
    assert "/company-targets" in paths


def test_company_targets_endpoint_returns_document_companies():
    client = TestClient(app)

    response = client.get("/company-targets?limit=3")

    assert response.status_code == 200
    targets = response.json()
    assert len(targets) == 3
    assert targets[0]["company"] == "Amazon / AWS"
    assert targets[0]["career_url"] == "https://www.amazon.jobs/"
