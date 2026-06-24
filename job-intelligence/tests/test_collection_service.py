from collectors import CollectionRequest, CollectionResult
from collectors.base import now_utc
from api.services import CollectionService
from tests.test_repository import make_session


class FakeJobSpyCollector:
    def __init__(self):
        self.requests = []

    def collect(self, request):
        self.requests.append(request)
        return CollectionResult(
            request=request,
            run_started_at=now_utc(),
            run_finished_at=now_utc(),
            jobs=[],
            errors=[],
        )


class FakeCareerBuilderCollector(FakeJobSpyCollector):
    pass


def test_collection_service_partitions_non_jobspy_sources_from_jobspy():
    session = make_session()
    jobspy = FakeJobSpyCollector()
    careerbuilder = FakeCareerBuilderCollector()
    governmentjobs = FakeCareerBuilderCollector()
    adzuna = FakeCareerBuilderCollector()
    remoteok = FakeCareerBuilderCollector()
    remotely = FakeCareerBuilderCollector()
    weworkremotely = FakeCareerBuilderCollector()
    service = CollectionService(session, collector=jobspy)
    service.careerbuilder_collector = careerbuilder
    service.governmentjobs_collector = governmentjobs
    service.adzuna_collector = adzuna
    service.remoteok_collector = remoteok
    service.remotely_collector = remotely
    service.weworkremotely_collector = weworkremotely

    service.collect(
        CollectionRequest(
            search_term="Engineer",
            location="Dallas, TX",
            sites=[
                "linkedin",
                "careerbuilder",
                "governmentjobs",
                "adzuna",
                "remoteok",
                "remotely",
                "weworkremotely",
            ],
        )
    )

    assert jobspy.requests[0].sites == ["linkedin"]
    assert careerbuilder.requests[0].sites == ["careerbuilder"]
    assert governmentjobs.requests[0].sites == ["governmentjobs"]
    assert adzuna.requests[0].sites == ["adzuna"]
    assert remoteok.requests[0].sites == ["remoteok"]
    assert remotely.requests[0].sites == ["remotely"]
    assert weworkremotely.requests[0].sites == ["weworkremotely"]


def test_collection_service_turns_c2c_and_w2_into_keyword_searches():
    session = make_session()
    jobspy = FakeJobSpyCollector()
    service = CollectionService(session, collector=jobspy)

    service.collect(
        CollectionRequest(
            search_term="developer",
            location="United States",
            sites=["linkedin"],
            job_type="c2c",
        )
    )

    assert jobspy.requests[0].search_term == "developer C2C"
    assert jobspy.requests[0].job_type is None

    service.collect(
        CollectionRequest(
            search_term="developer W2",
            location="United States",
            sites=["linkedin"],
            job_type="w2",
        )
    )

    assert jobspy.requests[1].search_term == "developer W2"
    assert jobspy.requests[1].job_type is None


def test_collection_service_expands_dotnet_and_java_search_families():
    session = make_session()
    jobspy = FakeJobSpyCollector()
    service = CollectionService(session, collector=jobspy)

    service.collect(
        CollectionRequest(
            search_term=".Net,C#",
            location="United States",
            sites=["linkedin"],
        )
    )
    service.collect(
        CollectionRequest(
            search_term="Java developer",
            location="United States",
            sites=["linkedin"],
        )
    )

    assert "Senior C# Developer" in jobspy.requests[0].search_term
    assert "Senior ASP.NET Core Developer" in jobspy.requests[0].search_term
    assert "Dotnet Developer" in jobspy.requests[0].search_term
    assert "Senior Backend .NET Developer" in jobspy.requests[0].search_term
    assert "Azure .NET Developer" in jobspy.requests[0].search_term
    assert "Spring Boot Developer" in jobspy.requests[1].search_term
    assert "Java Solutions Architect" in jobspy.requests[1].search_term


def test_collection_service_expands_company_target_searches():
    session = make_session()
    jobspy = FakeJobSpyCollector()
    service = CollectionService(session, collector=jobspy)

    service.collect(
        CollectionRequest(
            search_term="developer",
            location="Texas",
            sites=["linkedin"],
            results_wanted=10,
            use_company_targets=True,
            company_target_limit=2,
        )
    )

    assert len(jobspy.requests) == 3
    assert jobspy.requests[0].search_term == "developer"
    assert jobspy.requests[1].search_term == "developer Amazon AWS"
    assert jobspy.requests[1].results_wanted == 5
    assert jobspy.requests[1].metadata["company_target"] == "Amazon / AWS"
    assert jobspy.requests[2].search_term == "developer Microsoft"


def test_collection_service_uses_source_specific_company_queries():
    session = make_session()
    jobspy = FakeJobSpyCollector()
    service = CollectionService(session, collector=jobspy)

    service.collect(
        CollectionRequest(
            search_term="developer",
            location="Texas",
            sites=["linkedin", "indeed", "google"],
            results_wanted=9,
            use_company_targets=True,
            company_target_limit=1,
            visa_friendly_only=True,
        )
    )

    assert [request.sites for request in jobspy.requests[:3]] == [["linkedin"], ["indeed"], ["google"]]
    company_requests = jobspy.requests[3:]
    assert [request.sites for request in company_requests] == [["linkedin"], ["indeed"], ["google"]]
    assert company_requests[0].search_term == "developer Amazon AWS H1B sponsorship visa"
    assert company_requests[1].search_term == 'developer "Amazon AWS" H1B sponsorship visa'
    assert company_requests[2].search_term == 'developer "Amazon AWS" jobs H1B sponsorship visa'


def test_collection_service_can_use_h1b_company_target_set(monkeypatch):
    session = make_session()
    jobspy = FakeJobSpyCollector()
    service = CollectionService(session, collector=jobspy)
    seen = {}

    def fake_select(limit, target_set="default"):
        seen["limit"] = limit
        seen["target_set"] = target_set
        return [{"rank": 1, "company": "Oracle America, Inc.", "sponsor_status": "Strong"}]

    monkeypatch.setattr("api.services.select_company_targets", fake_select)

    service.collect(
        CollectionRequest(
            search_term=".Net,C#",
            sites=["linkedin"],
            use_company_targets=True,
            company_target_limit=1096,
            metadata={"company_target_set": "h1b"},
        )
    )

    assert seen == {"limit": 1096, "target_set": "h1b"}
    assert jobspy.requests[1].search_term.endswith("Oracle America Inc.")


def test_collection_service_routes_career_page_source():
    session = make_session()
    jobspy = FakeJobSpyCollector()
    career_pages = FakeCareerBuilderCollector()
    service = CollectionService(session, collector=jobspy)
    service.career_page_collector = career_pages

    service.collect(
        CollectionRequest(
            search_term="developer",
            sites=["career_page"],
            results_wanted=5,
            use_company_targets=True,
            company_target_limit=2,
        )
    )

    assert jobspy.requests == []
    assert career_pages.requests[0].sites == ["career_page"]
    assert career_pages.requests[0].use_company_targets is True


def test_collection_service_routes_h1b_and_simple_web_sources():
    session = make_session()
    jobspy = FakeJobSpyCollector()
    jobright = FakeCareerBuilderCollector()
    dice = FakeCareerBuilderCollector()
    remotive = FakeCareerBuilderCollector()
    service = CollectionService(session, collector=jobspy)
    service.h1b_markdown_collectors["jobright_h1b"] = jobright
    service.simple_web_collectors["dice"] = dice
    service.simple_web_collectors["remotive"] = remotive

    service.collect(
        CollectionRequest(
            search_term="developer",
            sites=["jobright_h1b", "dice", "remotive"],
            results_wanted=5,
        )
    )

    assert jobspy.requests == []
    assert jobright.requests[0].sites == ["jobright_h1b"]
    assert dice.requests[0].sites == ["dice"]
    assert remotive.requests[0].sites == ["remotive"]


def test_collection_service_retries_governmentjobs_with_fallback_locations():
    class FakeGovernmentJobsCollector(FakeJobSpyCollector):
        def collect(self, request):
            self.requests.append(request)
            if len(self.requests) == 1:
                return CollectionResult(
                    request=request,
                    run_started_at=now_utc(),
                    run_finished_at=now_utc(),
                    jobs=[],
                    errors=["governmentjobs returned no matching jobs"],
                )
            return CollectionResult(
                request=request,
                run_started_at=now_utc(),
                run_finished_at=now_utc(),
                jobs=[
                    {
                        "id": "governmentjobs-1",
                        "site": "governmentjobs",
                        "title": "Software Developer",
                        "company": "City of Dallas",
                        "location": request.location,
                        "description": ".NET government role",
                    }
                ],
                errors=[],
            )

    session = make_session()
    jobspy = FakeJobSpyCollector()
    governmentjobs = FakeGovernmentJobsCollector()
    service = CollectionService(session, collector=jobspy)
    service.governmentjobs_collector = governmentjobs

    _, result = service.collect(
        CollectionRequest(
            search_term=".NET developer",
            location="Remote",
            sites=["governmentjobs"],
            results_wanted=5,
        )
    )

    assert [request.location for request in governmentjobs.requests[:2]] == ["Remote", "Dallas, TX"]
    assert result.count == 1
    assert result.errors == []
