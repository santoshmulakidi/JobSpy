from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Callable

import httpx

from ai.resume_keyword_plan import build_keyword_plan, replace_two_recent_titles
from ai.resume_rebuilder import (
    _chat_completion,
    _extract_tailored_resume,
    _repair_incomplete_resume,
    _unsupported_numeric_claims,
)
from storage.config import Settings


class GenerationMode(StrEnum):
    HYBRID = "HYBRID"
    IMPORTANT = "IMPORTANT"


class TemporaryProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class OrchestrationRequest:
    source_resume: str
    job_description: str
    target_title: str
    company_name: str | None
    mode: GenerationMode


@dataclass
class GenerationEvent:
    code: str
    severity: str
    stage: str
    provider: str | None
    model: str | None
    attempt: int
    timestamp: str
    message: str


@dataclass
class OrchestrationResult:
    status: str
    resume_text: str | None
    diagnostic_draft: str | None = None
    events: list[GenerationEvent] = field(default_factory=list)
    original_titles: list[str] = field(default_factory=list)
    ats_score: int | None = None
    attempts: int = 1
    usage: dict[str, int] = field(default_factory=dict)

    @property
    def event_codes(self) -> list[str]:
        return [event.code for event in self.events]


CompletionFn = Callable[[dict[str, str], list[dict[str, str]]], str]


def _validate_generated_resume(text: str, *, base_resume: str) -> str:
    extracted = _extract_tailored_resume(text)
    repaired = _repair_incomplete_resume(rebuilt_resume=extracted, base_resume=base_resume)
    unsupported = _unsupported_numeric_claims(
        base_resume=base_resume, rebuilt_resume=repaired
    )
    if unsupported:
        raise ValueError("unsupported numeric claims: " + ", ".join(unsupported))
    return repaired


def _provider(name: str, base_url: str, api_key: str | None, model: str) -> dict[str, str]:
    return {"name": name, "base_url": base_url.rstrip("/"), "api_key": api_key or "", "model": model}


def _default_completion(provider: dict[str, str], messages: list[dict[str, str]]) -> str:
    try:
        return _chat_completion(provider=provider, messages=messages, settings=Settings())
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (408, 429) or exc.response.status_code >= 500:
            raise TemporaryProviderError("provider temporarily unavailable") from exc
        raise
    except (httpx.TimeoutException, httpx.ConnectError) as exc:
        raise TemporaryProviderError("provider temporarily unavailable") from exc


def _messages(request: OrchestrationRequest, *, draft: str | None = None) -> list[dict[str, str]]:
    plan = build_keyword_plan(
        request.source_resume, request.job_description, target_title=request.target_title
    )
    supported = ", ".join(plan.supported) or "None"
    unsupported = ", ".join(plan.unsupported) or "None"
    if draft is None:
        task = (
            "Write the complete tailored resume. Required supported JD keywords that must appear "
            f"naturally: {supported}. Unsupported JD keywords that must NOT be added: {unsupported}. "
            "Replace the displayed titles of the two most recent roles with the target title. "
            "Preserve employers, dates, education, contact details, responsibilities, and every other fact."
        )
    else:
        task = (
            "Review and return the complete corrected resume. Treat the source resume as the sole "
            "source of truth. Remove unsupported claims, AI filler, promotional wording, repetition, "
            "and uniform bullet patterns. Preserve all roles.\n\nWRITER DRAFT:\n" + draft
        )
    return [
        {"role": "system", "content": "You are a truthful ATS resume specialist. Output plain resume text only."},
        {"role": "user", "content": (
            f"TARGET TITLE: {request.target_title}\nCOMPANY: {request.company_name or ''}\n\n"
            f"SOURCE RESUME:\n{request.source_resume}\n\nJOB DESCRIPTION:\n{request.job_description}\n\n{task}"
        )},
    ]


def orchestrate_resume(
    request: OrchestrationRequest,
    settings: Settings,
    *,
    completion: CompletionFn = _default_completion,
) -> OrchestrationResult:
    events: list[GenerationEvent] = []

    def emit(code: str, severity: str, stage: str, provider: dict[str, str], message: str) -> None:
        events.append(GenerationEvent(
            code=code, severity=severity, stage=stage, provider=provider["name"],
            model=provider["model"], attempt=1,
            timestamp=datetime.now(UTC).isoformat(), message=message,
        ))

    nvidia = _provider("nvidia", settings.nvidia_base_url, settings.nvidia_api_key, settings.nvidia_resume_writer_model)
    paid_writer = _provider("openrouter", settings.openrouter_base_url, settings.openrouter_api_key, settings.openrouter_resume_writer_model)
    qwen = _provider("openrouter", settings.openrouter_base_url, settings.openrouter_api_key, settings.openrouter_resume_reviewer_model)
    kimi = _provider("openrouter", settings.openrouter_base_url, settings.openrouter_api_key, settings.openrouter_resume_reviewer_fallback_model)
    writer = nvidia if request.mode is GenerationMode.HYBRID else paid_writer
    emit("WRITER_STARTED", "info", "writer", writer, "Resume writer started")
    try:
        draft = completion(writer, _messages(request))
    except TemporaryProviderError:
        if request.mode is not GenerationMode.HYBRID:
            return OrchestrationResult(status="FAILED", resume_text=None, events=events)
        emit("NVIDIA_FAILURE", "warning", "writer", nvidia, "NVIDIA writer failed")
        emit("PAID_FALLBACK_ACTIVATED", "warning", "writer", paid_writer, "Restarting on paid OpenRouter")
        draft = completion(paid_writer, _messages(request))
        writer = paid_writer
    emit("WRITER_SUCCEEDED", "info", "writer", writer, "Resume writer completed")

    emit("REVIEWER_STARTED", "info", "reviewer", qwen, "Qwen review started")
    try:
        reviewed = completion(qwen, _messages(request, draft=draft))
    except TemporaryProviderError:
        emit("REVIEWER_FALLBACK", "warning", "reviewer", kimi, "Qwen failed; Kimi review started")
        try:
            reviewed = completion(kimi, _messages(request, draft=draft))
        except TemporaryProviderError:
            return OrchestrationResult(
                status="WRITER_ONLY", resume_text=None, diagnostic_draft=draft, events=events
            )

    try:
        validated = _validate_generated_resume(reviewed, base_resume=request.source_resume)
    except ValueError:
        validated = reviewed.strip()
    titled, originals = replace_two_recent_titles(validated, request.target_title)
    return OrchestrationResult(
        status="REVIEWED", resume_text=titled, events=events, original_titles=originals
    )
