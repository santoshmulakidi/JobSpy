import httpx

from ai.resume_orchestrator import (
    GenerationMode,
    OrchestrationRequest,
    TemporaryProviderError,
    orchestrate_resume,
)
from storage.config import Settings


BASE_RESUME = """Santosh Mulakidi
Senior .NET Developer

SUMMARY
Senior engineer with Python, Azure, C#, .NET, and REST API experience.

TECHNICAL SKILLS
Python, Azure, C#, .NET, REST API

PROFESSIONAL EXPERIENCE
Senior .NET Developer | Acme Corp | Dallas, TX
2024 - Present
- Built Python and Azure APIs.

Software Engineer | Beta LLC | Austin, TX
2021 - 2024
- Developed REST API services.

Junior Developer | OldCo | Houston, TX
2018 - 2021
- Maintained C# applications.

EDUCATION
Master of Science
"""

JD = "AI Engineer requiring Python, Azure, REST API, LangChain, and Kubernetes."


def settings(*, repairs=0):
    return Settings(
        _env_file=None,
        nvidia_api_key="nv",
        openrouter_api_key="or",
        nvidia_resume_writer_model="nvidia/deepseek-v4-pro",
        openrouter_resume_writer_model="deepseek/deepseek-v4-pro",
        openrouter_resume_reviewer_model="qwen/qwen3.7-plus",
        openrouter_resume_reviewer_fallback_model="moonshotai/kimi-k2.5",
        resume_max_repairs=repairs,
    )


def request(mode=GenerationMode.HYBRID):
    return OrchestrationRequest(
        source_resume=BASE_RESUME,
        job_description=JD,
        target_title="AI Engineer",
        company_name="Example",
        mode=mode,
    )


class FakeCompletion:
    def __init__(self, failures=()):
        self.failures = list(failures)
        self.models = []
        self.prompts = []

    def __call__(self, provider, messages):
        model = provider["model"]
        self.models.append(model)
        self.prompts.append(messages[-1]["content"])
        if self.failures and self.failures[0] == model:
            self.failures.pop(0)
            raise TemporaryProviderError("temporary")
        return BASE_RESUME


def test_hybrid_uses_direct_nvidia_then_openrouter_qwen():
    fake = FakeCompletion()
    result = orchestrate_resume(request(), settings(), completion=fake)
    assert fake.models == ["nvidia/deepseek-v4-pro", "qwen/qwen3.7-plus"]
    assert result.status == "REVIEWED"
    assert "omniroute" not in " ".join(fake.prompts).lower()
    assert "LangChain" in fake.prompts[0]  # explicitly marked unsupported


def test_nvidia_failure_restarts_from_original_on_openrouter():
    fake = FakeCompletion(failures=("nvidia/deepseek-v4-pro",))
    result = orchestrate_resume(request(), settings(), completion=fake)
    assert fake.models == [
        "nvidia/deepseek-v4-pro",
        "deepseek/deepseek-v4-pro",
        "qwen/qwen3.7-plus",
    ]
    assert BASE_RESUME in fake.prompts[1]
    assert "NVIDIA_FAILURE" in result.event_codes
    assert "PAID_FALLBACK_ACTIVATED" in result.event_codes


def test_important_skips_nvidia_and_kimi_reuses_writer_draft():
    fake = FakeCompletion(failures=("qwen/qwen3.7-plus",))
    result = orchestrate_resume(request(GenerationMode.IMPORTANT), settings(), completion=fake)
    assert fake.models == [
        "deepseek/deepseek-v4-pro",
        "qwen/qwen3.7-plus",
        "moonshotai/kimi-k2.5",
    ]
    assert BASE_RESUME in fake.prompts[-1]
    assert "REVIEWER_FALLBACK" in result.event_codes


def test_both_reviewers_failing_is_not_success():
    fake = FakeCompletion(failures=("qwen/qwen3.7-plus", "moonshotai/kimi-k2.5"))
    result = orchestrate_resume(request(GenerationMode.IMPORTANT), settings(), completion=fake)
    assert result.status == "WRITER_ONLY"
    assert result.resume_text is None
    assert "FINAL_FAILURE" in result.event_codes


def test_paid_writer_failure_returns_a_visible_final_failure():
    fake = FakeCompletion(failures=("deepseek/deepseek-v4-pro",))
    result = orchestrate_resume(request(GenerationMode.IMPORTANT), settings(), completion=fake)
    assert result.status == "FAILED"
    assert result.resume_text is None
    assert "FINAL_FAILURE" in result.event_codes


def test_below_85_uses_targeted_repair_and_stops_when_target_reached():
    fake = FakeCompletion()
    scores = iter((72, 86))
    result = orchestrate_resume(
        request(GenerationMode.IMPORTANT),
        settings(repairs=2),
        completion=fake,
        score_fn=lambda _resume, _jd: next(scores),
    )
    assert fake.models == [
        "deepseek/deepseek-v4-pro",
        "qwen/qwen3.7-plus",
        "qwen/qwen3.7-plus",
    ]
    assert result.ats_score == 86
    assert result.attempts == 2
    assert "ATS_REPAIR_STARTED" in result.event_codes
    assert "ATS_TARGET_REACHED" in result.event_codes
