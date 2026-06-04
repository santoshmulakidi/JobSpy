from collectors.base import CollectionRequest, CollectionResult
from collectors.ats_career_collector import AtsCareerPageCollector
from collectors.careerbuilder_collector import CareerBuilderCollector
from collectors.jobspy_collector import JobSpyCollector
from collectors.markdown_job_collector import MarkdownJobCollector
from collectors.remotely_collector import RemotelyJobsCollector
from collectors.simple_web_job_collector import SimpleWebJobCollector
from collectors.weworkremotely_collector import WeWorkRemotelyCollector

__all__ = [
    "CareerBuilderCollector",
    "CollectionRequest",
    "CollectionResult",
    "AtsCareerPageCollector",
    "JobSpyCollector",
    "MarkdownJobCollector",
    "RemotelyJobsCollector",
    "SimpleWebJobCollector",
    "WeWorkRemotelyCollector",
]
