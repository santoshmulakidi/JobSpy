from collectors.base import CollectionRequest, CollectionResult
from collectors.ats_career_collector import AtsCareerPageCollector
from collectors.careerbuilder_collector import CareerBuilderCollector
from collectors.governmentjobs_collector import GovernmentJobsCollector
from collectors.jobspy_collector import JobSpyCollector
from collectors.markdown_job_collector import MarkdownJobCollector
from collectors.remotely_collector import RemotelyJobsCollector
from collectors.simple_web_job_collector import SimpleWebJobCollector
from collectors.usajobs_collector import USAJobsCollector
from collectors.weworkremotely_collector import WeWorkRemotelyCollector

__all__ = [
    "CareerBuilderCollector",
    "CollectionRequest",
    "CollectionResult",
    "GovernmentJobsCollector",
    "AtsCareerPageCollector",
    "JobSpyCollector",
    "MarkdownJobCollector",
    "RemotelyJobsCollector",
    "SimpleWebJobCollector",
    "USAJobsCollector",
    "WeWorkRemotelyCollector",
]
