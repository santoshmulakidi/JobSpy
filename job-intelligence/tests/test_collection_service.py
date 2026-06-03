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
