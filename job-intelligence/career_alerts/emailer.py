"""Render and deliver career alert email messages."""

from __future__ import annotations

import json
import smtplib
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from html import escape
from pathlib import Path
from typing import Protocol
from urllib.parse import urlparse

from career_alerts.types import MatchedJob, Stream
from career_alerts.windows import CENTRAL, DeliveryWindow

DEFAULT_CONFIG_PATH = Path("/home/ubuntu/.hermes/email_config.json")
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
SMTP_TIMEOUT_SECONDS = 30
MAX_JOBS_PER_MESSAGE = 100
_STREAM_NAMES: dict[Stream, str] = {
    "dotnet": ".NET Developer",
    "ai_engineer": "AI Engineer",
}
_BUCKET_ORDER = {"Remote": 0, "DFW Metro": 1, "Other USA": 2}


@dataclass(frozen=True)
class EmailJob:
    match: MatchedJob
    first_seen_at: datetime


def subject(
    stream: Stream,
    window: DeliveryWindow,
    count: int,
    part: tuple[int, int] | None = None,
) -> str:
    """Build the stable role-specific subject for one delivery message."""
    if count < 0:
        raise ValueError("job count cannot be negative")
    prefix = {
        "regular": "3-Hour Jobs",
        "overnight": "Overnight Jobs",
        "weekend": "Weekend Jobs",
    }[window.kind]
    result = (
        f"[{prefix}][{_STREAM_NAMES[stream]}] "
        f"{_hour_label(window.end)} CT - {count} New Jobs"
    )
    if part is not None:
        current, total = part
        if not (1 <= current <= total):
            raise ValueError("email part must be within the total part count")
        result += f" [Part {current}/{total}]"
    return result


def render_email(
    stream: Stream,
    window: DeliveryWindow,
    jobs: Sequence[EmailJob],
) -> list[EmailMessage]:
    """Sort and render one role stream, splitting at 100 jobs per message."""
    ordered = sorted(jobs, key=_sort_key)
    for item in ordered:
        _validated_application_url(item.match.job.apply_url)

    chunks = [ordered[index : index + MAX_JOBS_PER_MESSAGE] for index in range(0, len(ordered), MAX_JOBS_PER_MESSAGE)]
    if not chunks:
        chunks = [[]]
    total_parts = len(chunks)
    total_jobs = len(ordered)
    messages: list[EmailMessage] = []
    for index, chunk in enumerate(chunks, start=1):
        part = (index, total_parts) if total_parts > 1 else None
        message = EmailMessage()
        message["Subject"] = subject(stream, window, total_jobs, part)
        message.set_content(_plain_body(stream, window, chunk))
        message.add_alternative(_html_body(stream, window, chunk), subtype="html")
        messages.append(message)
    return messages


class _SmtpConnection(Protocol):
    def __enter__(self): ...
    def __exit__(self, exc_type, exc, traceback): ...
    def login(self, user: str, password: str): ...
    def send_message(self, message: EmailMessage): ...


class SmtpMailer:
    """Send a rendered message using the private Hermes email config."""

    def __init__(
        self,
        *,
        config_path: str | Path = DEFAULT_CONFIG_PATH,
        smtp_factory: Callable[..., _SmtpConnection] = smtplib.SMTP_SSL,
    ) -> None:
        self.config_path = Path(config_path)
        self.smtp_factory = smtp_factory

    def send(self, message: EmailMessage) -> None:
        sender, recipient, app_password = self._load_config()
        _set_header(message, "From", sender)
        _set_header(message, "To", recipient)
        with self.smtp_factory(
            SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS
        ) as smtp:
            smtp.login(sender, app_password)
            smtp.send_message(message)

    def _load_config(self) -> tuple[str, str, str]:
        try:
            payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("email config could not be loaded") from exc
        if not isinstance(payload, dict):
            raise TypeError("email config must be an object")
        sender = _config_text(payload, "sender", "sender_email")
        recipient = _config_text(payload, "recipient", "recipient_email")
        password = _config_text(payload, "app_password")
        if not sender or not recipient or not password:
            raise ValueError("email config requires sender, recipient, and app_password")
        return sender, recipient, password


def _config_text(payload: dict[str, object], *names: str) -> str | None:
    for name in names:
        value = payload.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _set_header(message: EmailMessage, name: str, value: str) -> None:
    if name in message:
        message.replace_header(name, value)
    else:
        message[name] = value


def _sort_key(item: EmailJob) -> tuple[int, str, str]:
    match = item.match
    return (
        _BUCKET_ORDER.get(match.location_bucket, len(_BUCKET_ORDER)),
        match.job.company.casefold(),
        match.job.title.casefold(),
    )


def _plain_body(
    stream: Stream, window: DeliveryWindow, jobs: Sequence[EmailJob]
) -> str:
    heading = f"{_STREAM_NAMES[stream]} — {window.label}"
    if not jobs:
        return f"{heading}\n\nNo new jobs in this delivery window.\n"
    lines = [heading, ""]
    for item in jobs:
        job = item.match.job
        lines.extend(
            [
                f"{job.company} — {job.title}",
                f"Location: {job.location}",
                *([f"Posted: {_date_label(job.posted_at)}"] if job.posted_at else []),
                f"First seen: {_datetime_label(item.first_seen_at)}",
                f"Apply: {job.apply_url}",
                "",
            ]
        )
    return "\n".join(lines)


def _html_body(
    stream: Stream, window: DeliveryWindow, jobs: Sequence[EmailJob]
) -> str:
    heading = f"{escape(_STREAM_NAMES[stream])} — {escape(window.label)}"
    if not jobs:
        return (
            "<!doctype html><html><body>"
            f"<h1>{heading}</h1><p>No new jobs in this delivery window.</p>"
            "</body></html>"
        )
    rendered_jobs = []
    for item in jobs:
        job = item.match.job
        posted = (
            f"<div>Posted: {escape(_date_label(job.posted_at))}</div>"
            if job.posted_at
            else ""
        )
        rendered_jobs.append(
            '<article class="job">'
            f"<h2>{escape(job.company)} — {escape(job.title)}</h2>"
            f"<div>Location: {escape(job.location)}</div>"
            f"{posted}"
            f"<div>First seen: {escape(_datetime_label(item.first_seen_at))}</div>"
            f'<div><a href="{escape(job.apply_url, quote=True)}">Apply on official site</a></div>'
            "</article>"
        )
    return (
        "<!doctype html><html><body>"
        f"<h1>{heading}</h1>{''.join(rendered_jobs)}"
        "</body></html>"
    )


def _validated_application_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("job must have an official HTTPS application URL")
    return url


def _date_label(value: datetime) -> str:
    local = value.astimezone(CENTRAL)
    return f"{local:%b} {local.day}, {local.year}"


def _datetime_label(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("first_seen_at must be timezone-aware")
    local = value.astimezone(CENTRAL)
    return f"{_date_label(local)} {_hour_minute_label(local)} CT"


def _hour_label(value: datetime) -> str:
    hour = value.hour % 12 or 12
    return f"{hour} {'AM' if value.hour < 12 else 'PM'}"


def _hour_minute_label(value: datetime) -> str:
    hour = value.hour % 12 or 12
    return f"{hour}:{value.minute:02d} {'AM' if value.hour < 12 else 'PM'}"
