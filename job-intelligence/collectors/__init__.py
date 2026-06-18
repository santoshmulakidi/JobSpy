from collectors.base import CollectionRequest, CollectionResult
from collectors.ats_career_collector import AtsCareerPageCollector
from collectors.adzuna_collector import AdzunaCollector
from collectors.careerbuilder_collector import CareerBuilderCollector
from collectors.governmentjobs_collector import GovernmentJobsCollector
from collectors.jobspy_collector import JobSpyCollector
from collectors.markdown_job_collector import MarkdownJobCollector
from collectors.remoteok_collector import RemoteOKCollector
from collectors.remotely_collector import RemotelyJobsCollector
from collectors.simple_web_job_collector import SimpleWebJobCollector
from collectors.weworkremotely_collector import WeWorkRemotelyCollector

__all__ = [
    "AdzunaCollector",
    "CareerBuilderCollector",
    "CollectionRequest",
    "CollectionResult",
    "GovernmentJobsCollector",
    "AtsCareerPageCollector",
    "JobSpyCollector",
    "MarkdownJobCollector",
    "RemoteOKCollector",
    "RemotelyJobsCollector",
    "SimpleWebJobCollector",
    "WeWorkRemotelyCollector",
]
