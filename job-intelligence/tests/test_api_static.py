import base64
import io
import zipfile

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
    assert "Applications" in response.text
    assert "Saved searches" in response.text
    assert "Resume Lab" in response.text
    assert "Preferences" in response.text
    assert "Qualified" in response.text
    assert "Disqualified" in response.text
    assert "Application tracker" in response.text
    assert "Job preferences" in response.text
    assert "credibility-v1" in response.text
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
    assert "Save search" in response.text
    assert "ATS match, keyword gaps, and recruiter credibility review" in response.text
    assert "Copy AI prompt" in response.text
    assert "Base resume notes" in response.text
    assert "Attach resume" in response.text
    assert "profileSelect" in response.text
    assert "resumeFileInput" in response.text
    assert "DOCX and TXT supported locally" in response.text
    assert "Download credibility report" in response.text
    assert "recruiter credibility review" in response.text
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
    assert "Jobspresso" in response.text
    assert "Dynamite Jobs" in response.text
    assert "SkipTheDrive" in response.text
    assert "Remotive" in response.text
    assert "YC Jobs" in response.text
    assert ".NET developer or Java developer" in response.text
    assert "Remotely.jobs" in response.text
    assert "Only working sources are shown" in response.text
    assert "JobsH1B" not in response.text
    assert "VisaFriendly" not in response.text
    assert "Glever" not in response.text
    assert "JobsGrep" not in response.text
    assert "HiringCafe" not in response.text
    assert "Career Hound" not in response.text
    assert "Wellfound" not in response.text
    assert "College Recruiter" not in response.text
    assert "CareerBuilder" not in response.text
    assert "We Work Remotely" not in response.text
    assert "blocked" not in response.text
    assert "no parse" not in response.text
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
    assert "jobspresso" in response.text
    assert "dynamitejobs" in response.text
    assert "skipthedrive" in response.text
    assert "remotive" in response.text
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
    assert "parseApiDateTime" in response.text
    assert "centralDateTime" in response.text
    assert "America/Chicago" in response.text
    assert "postingTimestamp" in response.text
    assert "jobIntelligenceScore" in response.text
    assert "sendForResume" in response.text
    assert "sendForCoverLetter" in response.text
    assert "markApplied" in response.text
    assert "jobTrustScore" in response.text
    assert "trust_score" in response.text
    assert "saveCurrentSearch" in response.text
    assert "renderResumeLab" in response.text
    assert "copyTailoringPrompt" in response.text
    assert "recruiterAuthenticityReview" in response.text
    assert "downloadAuthenticityReport" in response.text
    assert "Recruiter credibility" in response.text
    assert "job-intelligence-base-resume" in response.text
    assert "job-intelligence-profile-store" in response.text
    assert "/resume/parse" in response.text
    assert "importResumeFile" in response.text
    assert "data-job-resume-lab-id" in response.text
    assert "Open this job in Resume Lab" in response.text
    assert "/saved-searches" in response.text
    assert "/profile" in response.text
    assert "/applications" in response.text
    assert "/apply" in response.text
    assert "qualification_status" in response.text
    assert "job-intelligence-applications" in response.text
    assert "job-intelligence-preferences" in response.text
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
    assert "/profile" in paths
    assert "/applications" in paths
    assert "/jobs/{job_id}/apply" in paths
    assert "/resume/parse" in paths
    assert "/saved-searches" in paths
    assert "/saved-searches/{saved_search_id}" in paths
    assert "/scheduler/status" in paths
    assert "/scheduler/start" in paths
    assert "/scheduler/stop" in paths


def test_resume_parse_endpoint_reads_txt_and_docx():
    client = TestClient(app)

    txt_response = client.post(
        "/resume/parse",
        json={
            "filename": "resume.txt",
            "content_base64": base64.b64encode(b"Senior .NET Developer").decode(),
        },
    )

    assert txt_response.status_code == 200
    assert txt_response.json()["text"] == "Senior .NET Developer"

    docx_buffer = io.BytesIO()
    with zipfile.ZipFile(docx_buffer, "w") as archive:
        archive.writestr(
            "word/document.xml",
            (
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body><w:p><w:r><w:t>Azure AKS Developer</w:t></w:r></w:p></w:body>"
                "</w:document>"
            ),
        )

    docx_response = client.post(
        "/resume/parse",
        json={
            "filename": "resume.docx",
            "content_base64": base64.b64encode(docx_buffer.getvalue()).decode(),
        },
    )

    assert docx_response.status_code == 200
    assert docx_response.json()["text"] == "Azure AKS Developer"


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
