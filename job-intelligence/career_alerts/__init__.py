"""Official-career source collection for H-1B sponsors."""

from career_alerts.registry import load_registry, validate_registry
from career_alerts.types import CareerJob, MatchedJob, SponsorTarget

__all__ = [
    "CareerJob",
    "MatchedJob",
    "SponsorTarget",
    "load_registry",
    "validate_registry",
]
