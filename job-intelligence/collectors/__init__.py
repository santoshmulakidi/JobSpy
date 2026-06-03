from collectors.base import CollectionRequest, CollectionResult
from collectors.careerbuilder_collector import CareerBuilderCollector
from collectors.jobspy_collector import JobSpyCollector
from collectors.remotely_collector import RemotelyJobsCollector
from collectors.weworkremotely_collector import WeWorkRemotelyCollector

__all__ = [
    "CareerBuilderCollector",
    "CollectionRequest",
    "CollectionResult",
    "JobSpyCollector",
    "RemotelyJobsCollector",
    "WeWorkRemotelyCollector",
]
