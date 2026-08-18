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
        nvidia_resume_writer_model="nvidia/nemotron-3-ultra-550b-a55b",
        nvidia_resume_writer_fallback_model="z-ai/glm-5.2",
        openrouter_resume_writer_model="deepseek/deepseek-v4-pro",
        omniroute_api_key="om",
        omniroute_resume_writer_model="no-think/claude/claude-sonnet-5",
        omniroute_resume_writer_best_model="claude/claude-sonnet-5",
        omniroute_resume_reviewer_model="no-think/claude/claude-haiku-4-5-20251001",
        omniroute_resume_reviewer_fallback_model="no-think/claude/claude-sonnet-5",
        resume_max_repairs=repairs,
    )


def request(mode=GenerationMode.HYBRID, speed="balanced"):
    return OrchestrationRequest(
        source_resume=BASE_RESUME,
        job_description=JD,
        target_title="AI Engineer",
        company_name="Example",
        mode=mode,
        speed=speed,
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


def test_balanced_writes_on_omniroute_then_reviews_with_claude_haiku():
    fake = FakeCompletion()
    result = orchestrate_resume(request(), settings(), completion=fake)
    assert fake.models == [
        "no-think/claude/claude-sonnet-5",
        "no-think/claude/claude-haiku-4-5-20251001",
    ]
    assert result.status == "REVIEWED"
    assert "LangChain" in fake.prompts[0]  # explicitly marked unsupported


def test_balanced_never_calls_nemotron_ultra():
    fake = FakeCompletion()
    orchestrate_resume(request(), settings(), completion=fake)
    assert "nvidia/nemotron-3-ultra-550b-a55b" not in fake.models


def test_balanced_writer_failure_falls_back_to_free_nvidia():
    fake = FakeCompletion(failures=("no-think/claude/claude-sonnet-5",))
    result = orchestrate_resume(request(), settings(), completion=fake)
    assert fake.models == [
        "no-think/claude/claude-sonnet-5",
        "z-ai/glm-5.2",
        "no-think/claude/claude-haiku-4-5-20251001",
    ]
    assert result.status == "REVIEWED"
    assert "WRITER_FALLBACK" in result.event_codes


def test_fast_uses_free_nvidia_writer_and_skips_repairs():
    fake = FakeCompletion()
    result = orchestrate_resume(
        request(speed="fast"), settings(repairs=2), completion=fake,
        score_fn=lambda _resume, _jd: 40,
    )
    assert fake.models == ["z-ai/glm-5.2", "no-think/claude/claude-haiku-4-5-20251001"]
    assert result.attempts == 1
    assert "ATS_REPAIR_STARTED" not in result.event_codes


def test_best_uses_thinking_writer_and_allows_two_repairs():
    fake = FakeCompletion()
    scores = iter((40, 50, 60))
    result = orchestrate_resume(
        request(speed="best"), settings(repairs=2), completion=fake,
        score_fn=lambda _resume, _jd: next(scores),
    )
    assert fake.models[0] == "claude/claude-sonnet-5"
    assert result.attempts == 3
    assert "ATS_TARGET_NOT_REACHED" in result.event_codes


def test_all_writers_failing_is_a_visible_final_failure():
    fake = FakeCompletion(failures=("z-ai/glm-5.2", "no-think/claude/claude-sonnet-5"))
    result = orchestrate_resume(request(speed="fast"), settings(), completion=fake)
    assert result.status == "FAILED"
    assert result.resume_text is None
    assert "FINAL_FAILURE" in result.event_codes


def test_reviewer_falls_back_before_giving_up():
    fake = FakeCompletion(failures=("no-think/claude/claude-haiku-4-5-20251001",))
    result = orchestrate_resume(request(), settings(), completion=fake)
    assert result.status == "REVIEWED"
    assert "REVIEWER_FALLBACK" in result.event_codes


def test_both_reviewers_failing_is_not_success():
    fake = FakeCompletion(failures=(
        "no-think/claude/claude-haiku-4-5-20251001",
        "no-think/claude/claude-sonnet-5",
    ))
    result = orchestrate_resume(request(speed="fast"), settings(), completion=fake)
    assert result.status == "WRITER_ONLY"
    assert result.resume_text is None
    assert "FINAL_FAILURE" in result.event_codes


def test_below_85_uses_targeted_repair_and_stops_when_target_reached():
    fake = FakeCompletion()
    scores = iter((72, 86))
    result = orchestrate_resume(
        request(), settings(repairs=2), completion=fake,
        score_fn=lambda _resume, _jd: next(scores),
    )
    assert result.ats_score == 86
    assert result.attempts == 2
    assert "ATS_REPAIR_STARTED" in result.event_codes
    assert "ATS_TARGET_REACHED" in result.event_codes


def test_internal_score_ignores_job_description_prose():
    # The JD is mostly boilerplate the resume can never truthfully match; only
    # the supported tech terms should count toward the repair target.
    prose_jd = (
        "We are seeking a highly experienced candidate. Verbal and written "
        "communication is critical. Desirable qualifications include the "
        "ability to learn quickly. Requires Python and Azure experience."
    )
    fake = FakeCompletion()
    result = orchestrate_resume(
        OrchestrationRequest(
            source_resume=BASE_RESUME, job_description=prose_jd,
            target_title="AI Engineer", company_name="Example",
            mode=GenerationMode.HYBRID, speed="balanced",
        ),
        settings(repairs=2), completion=fake,
    )
    # BASE_RESUME genuinely contains Python and Azure, so coverage is complete
    # and no repair pass is needed despite the unmatched prose.
    assert result.ats_score == 100
    assert "ATS_REPAIR_STARTED" not in result.event_codes
    assert "ATS_TARGET_REACHED" in result.event_codes


def _request_with_model(provider, model, speed="balanced"):
    return OrchestrationRequest(
        source_resume=BASE_RESUME, job_description=JD, target_title="AI Engineer",
        company_name="Example", mode=GenerationMode.HYBRID, speed=speed,
        writer_provider=provider, writer_model=model,
    )


def test_selected_writer_model_leads_the_chain():
    fake = FakeCompletion()
    orchestrate_resume(
        _request_with_model("omniroute", "claude/claude-opus-5"),
        settings(), completion=fake,
    )
    assert fake.models[0] == "claude/claude-opus-5"


def test_selected_writer_falls_back_to_the_tier_chain():
    fake = FakeCompletion(failures=("claude/claude-opus-5",))
    result = orchestrate_resume(
        _request_with_model("omniroute", "claude/claude-opus-5"),
        settings(), completion=fake,
    )
    assert fake.models[:2] == ["claude/claude-opus-5", "no-think/claude/claude-sonnet-5"]
    assert result.status == "REVIEWED"


def test_selected_model_is_not_duplicated_in_the_chain():
    fake = FakeCompletion(failures=("no-think/claude/claude-sonnet-5",))
    orchestrate_resume(
        _request_with_model("omniroute", "no-think/claude/claude-sonnet-5"),
        settings(), completion=fake,
    )
    writer_calls = [m for m in fake.models if m == "no-think/claude/claude-sonnet-5"]
    assert len(writer_calls) == 1


def test_no_selected_model_keeps_the_tier_default():
    fake = FakeCompletion()
    orchestrate_resume(request(), settings(), completion=fake)
    assert fake.models[0] == "no-think/claude/claude-sonnet-5"


def _paged_request(pages):
    return OrchestrationRequest(
        source_resume=BASE_RESUME, job_description=JD, target_title="AI Engineer",
        company_name="Example", mode=GenerationMode.HYBRID, speed="balanced",
        target_pages=pages,
    )


def test_page_target_reaches_writer_reviewer_and_repair_prompts():
    fake = FakeCompletion()
    orchestrate_resume(
        _paged_request(1), settings(repairs=1), completion=fake,
        score_fn=lambda _r, _j: 40,
    )
    # writer, reviewer and the repair pass must all carry the budget
    assert len(fake.prompts) == 3
    for prompt in fake.prompts:
        assert "LENGTH TARGET" in prompt
        assert "550 words" in prompt


def test_page_target_never_asks_to_drop_roles():
    fake = FakeCompletion()
    orchestrate_resume(_paged_request(1), settings(), completion=fake)
    assert "Condense by shortening and merging bullets, not by removing roles." in fake.prompts[0]


def test_two_and_three_page_targets_use_larger_budgets():
    for pages, budget in ((2, "950 words"), (3, "1400 words")):
        fake = FakeCompletion()
        orchestrate_resume(_paged_request(pages), settings(), completion=fake)
        assert budget in fake.prompts[0]


def test_no_page_target_leaves_prompts_unconstrained():
    fake = FakeCompletion()
    orchestrate_resume(_paged_request(None), settings(), completion=fake)
    assert all("LENGTH TARGET" not in p for p in fake.prompts)


from ai.resume_orchestrator import RefineRequest, refine_resume


def _refine(instruction="Shorten the summary.", **kw):
    return RefineRequest(
        source_resume=BASE_RESUME, current_resume=BASE_RESUME, job_description=JD,
        target_title="AI Engineer", instruction=instruction, **kw,
    )


def test_refine_uses_the_chosen_model_then_the_reviewer_chain():
    fake = FakeCompletion()
    result = refine_resume(
        _refine(writer_provider="omniroute", writer_model="claude/claude-opus-5"),
        settings(), completion=fake,
    )
    assert fake.models == ["claude/claude-opus-5"]
    assert result.status == "REVIEWED"
    assert "REFINE_SUCCEEDED" in result.event_codes


def test_refine_falls_back_when_a_provider_fails():
    fake = FakeCompletion(failures=("no-think/claude/claude-haiku-4-5-20251001",))
    result = refine_resume(_refine(), settings(), completion=fake)
    assert fake.models == [
        "no-think/claude/claude-haiku-4-5-20251001",
        "no-think/claude/claude-sonnet-5",
    ]
    assert result.status == "REVIEWED"


# A resume whose experience section clears the repair minimum, so the numeric
# gate is what rejects the output rather than the section-restore safety net.
FULL_RESUME = BASE_RESUME.replace(
    "- Built Python and Azure APIs.",
    "- Built Python and Azure APIs.\n"
    + "\n".join(
        f"- Delivered REST endpoints and Azure Functions for workstream {n}, "
        "covering validation, retries, and production support." for n in range(1, 9)
    ),
)


def test_refine_rejects_output_that_invents_numbers():
    # This is the gate refinement previously skipped entirely.
    class Fabricator(FakeCompletion):
        def __call__(self, provider, messages):
            self.models.append(provider["model"])
            return FULL_RESUME.replace(
                "- Built Python and Azure APIs.",
                "- Built Python and Azure APIs, cutting latency by 97%.",
            )

    fake = Fabricator()
    result = refine_resume(
        RefineRequest(
            source_resume=FULL_RESUME, current_resume=FULL_RESUME, job_description=JD,
            target_title="AI Engineer", instruction="Tighten the bullets.",
        ),
        settings(), completion=fake,
    )
    assert result.status == "FAILED"
    assert result.resume_text is None
    assert "REFINE_REJECTED" in result.event_codes


def test_refine_carries_the_page_budget():
    fake = FakeCompletion()
    refine_resume(_refine(target_pages=1), settings(), completion=fake)
    assert "LENGTH TARGET" in fake.prompts[0]


def test_refine_shows_the_model_the_source_of_truth():
    fake = FakeCompletion()
    refine_resume(_refine(), settings(), completion=fake)
    assert "SOURCE RESUME (truth baseline)" in fake.prompts[0]
    assert "Shorten the summary." in fake.prompts[0]
