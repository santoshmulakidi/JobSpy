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
    remotely = FakeCareerBuilderCollector()
    weworkremotely = FakeCareerBuilderCollector()
    service = CollectionService(session, collector=jobspy)
    service.careerbuilder_collector = careerbuilder
    service.remotely_collector = remotely
    service.weworkremotely_collector = weworkremotely

    service.collect(
        CollectionRequest(
            search_term="Engineer",
            location="Dallas, TX",
            sites=["linkedin", "careerbuilder", "remotely", "weworkremotely"],
        )
    )

    assert jobspy.requests[0].sites == ["linkedin"]
    assert careerbuilder.requests[0].sites == ["careerbuilder"]
    assert remotely.requests[0].sites == ["remotely"]
    assert weworkremotely.requests[0].sites == ["weworkremotely"]


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

    company_requests = jobspy.requests[1:]
    assert [request.sites for request in company_requests] == [["linkedin"], ["indeed"], ["google"]]
    assert company_requests[0].search_term == "developer Amazon AWS H1B sponsorship visa"
    assert company_requests[1].search_term == 'developer "Amazon AWS" H1B sponsorship visa'
    assert company_requests[2].search_term == 'developer "Amazon AWS" jobs H1B sponsorship visa'


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
    service = CollectionService(session, collector=jobspy)
    service.h1b_markdown_collectors["jobright_h1b"] = jobright
    service.simple_web_collectors["dice"] = dice

    service.collect(
        CollectionRequest(
            search_term="developer",
            sites=["jobright_h1b", "dice"],
            results_wanted=5,
        )
    )

    assert jobspy.requests == []
    assert jobright.requests[0].sites == ["jobright_h1b"]
    assert dice.requests[0].sites == ["dice"]
