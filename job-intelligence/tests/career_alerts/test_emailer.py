import json
from datetime import UTC, datetime
from email.message import EmailMessage
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from career_alerts.emailer import EmailJob, SmtpMailer, render_email, subject
from career_alerts.types import CareerJob, MatchedJob
from career_alerts.windows import delivery_window

CENTRAL = ZoneInfo("America/Chicago")
REGULAR_WINDOW = delivery_window(datetime(2026, 8, 12, 10, 0, tzinfo=CENTRAL))


def email_job(
    number=1,
    *,
    stream="dotnet",
    bucket="DFW Metro",
    company="Acme",
    title="Senior .NET Developer",
    location="Dallas, TX",
    apply_url=None,
    posted_at=None,
    first_seen_at=None,
):
    job = CareerJob(
        source_key="greenhouse:acme",
        provider="greenhouse",
        provider_job_id=str(number),
        company=company,
        sponsor_names=("Acme LLC",),
        title=title,
        location=location,
        description="Build APIs",
        apply_url=apply_url or f"https://careers.acme.test/jobs/{number}",
        posted_at=posted_at,
        is_remote=bucket == "Remote",
    )
    match = MatchedJob(job, frozenset({stream}), bucket)
    return EmailJob(
        match=match,
        first_seen_at=first_seen_at or datetime(2026, 8, 12, 14, 15, tzinfo=UTC),
    )


def html_body(message):
    return message.get_body(preferencelist=("html",)).get_content()


def test_regular_subject_contains_three_hour_jobs():
    assert subject("dotnet", REGULAR_WINDOW, 14) == (
        "[3-Hour Jobs][.NET Developer] 10 AM CT - 14 New Jobs"
    )


def test_zero_result_subject_and_message_are_still_rendered_per_stream():
    dotnet = render_email("dotnet", REGULAR_WINDOW, [])
    ai = render_email("ai_engineer", REGULAR_WINDOW, [])

    assert len(dotnet) == len(ai) == 1
    assert dotnet[0]["Subject"].endswith("0 New Jobs")
    assert ai[0]["Subject"] == "[3-Hour Jobs][AI Engineer] 10 AM CT - 0 New Jobs"
    assert "No new jobs" in html_body(dotnet[0])
    assert dotnet[0]["Subject"] != ai[0]["Subject"]


def test_weekend_and_overnight_subject_prefixes():
    weekend = delivery_window(datetime(2026, 8, 17, 7, 0, tzinfo=CENTRAL))
    overnight = delivery_window(datetime(2026, 8, 18, 7, 0, tzinfo=CENTRAL))

    assert subject("dotnet", weekend, 2).startswith("[Weekend Jobs]")
    assert subject("ai_engineer", overnight, 3).startswith("[Overnight Jobs]")


def test_rendering_sorts_buckets_then_company_and_title():
    jobs = [
        email_job(1, bucket="Other USA", company="Beta", title="Zeta Engineer"),
        email_job(2, bucket="DFW Metro", company="Acme", title="Zeta Engineer"),
        email_job(3, bucket="Remote", company="Beta", title="Alpha Engineer"),
        email_job(4, bucket="Remote", company="Acme", title="Zeta Engineer"),
        email_job(5, bucket="Remote", company="Acme", title="Alpha Engineer"),
    ]

    html = html_body(render_email("dotnet", REGULAR_WINDOW, jobs)[0])

    ordered_markers = [
        "Acme — Alpha Engineer",
        "Acme — Zeta Engineer",
        "Beta — Alpha Engineer",
        "Acme — Zeta Engineer",  # DFW occurrence
        "Beta — Zeta Engineer",
    ]
    positions = []
    cursor = 0
    for marker in ordered_markers:
        position = html.index(marker, cursor)
        positions.append(position)
        cursor = position + len(marker)
    assert positions == sorted(positions)


def test_rendering_escapes_content_and_includes_dates_times_and_https_link():
    item = email_job(
        title="R&D <Engineer>",
        company="A&B",
        location="Remote <USA>",
        bucket="Remote",
        posted_at=datetime(2026, 8, 10, 23, 0, tzinfo=UTC),
        first_seen_at=datetime(2026, 8, 12, 15, 15, tzinfo=UTC),
    )

    html = html_body(render_email("dotnet", REGULAR_WINDOW, [item])[0])

    assert "A&amp;B — R&amp;D &lt;Engineer&gt;" in html
    assert "Remote &lt;USA&gt;" in html
    assert "Posted: Aug 10, 2026" in html
    assert "First seen: Aug 12, 2026 10:15 AM CT" in html
    assert 'href="https://careers.acme.test/jobs/1"' in html


@pytest.mark.parametrize(
    "bad_url",
    ["http://careers.acme.test/jobs/1", "javascript:alert(1)", "https:///jobs/1"],
)
def test_rendering_rejects_non_https_or_hostless_application_links(bad_url):
    with pytest.raises(ValueError, match="HTTPS application URL"):
        render_email("dotnet", REGULAR_WINDOW, [email_job(apply_url=bad_url)])


def test_rendering_splits_every_100_jobs_with_part_suffixes():
    messages = render_email(
        "dotnet", REGULAR_WINDOW, [email_job(number) for number in range(201)]
    )

    assert len(messages) == 3
    assert [message["Subject"].rsplit(" ", 2)[-2:] for message in messages] == [
        ["[Part", "1/3]"],
        ["[Part", "2/3]"],
        ["[Part", "3/3]"],
    ]
    assert [html_body(message).count("class=\"job\"") for message in messages] == [
        100,
        100,
        1,
    ]


def test_smtp_mailer_loads_config_and_sends_with_required_transport(tmp_path):
    config_path = tmp_path / "email_config.json"
    config_path.write_text(
        json.dumps(
            {
                "sender": "career-alerts@example.com",
                "recipient": "recipient@example.com",
                "app_password": "not-a-real-secret",
            }
        )
    )
    observed = {}

    class FakeSmtp:
        def __init__(self, host, port, *, timeout):
            observed["connection"] = (host, port, timeout)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            observed["closed"] = True

        def login(self, sender, password):
            observed["login"] = (sender, password)

        def send_message(self, message):
            observed["message"] = message

    message = EmailMessage()
    message["Subject"] = "Career alert"
    message.set_content("Hello")

    SmtpMailer(config_path=config_path, smtp_factory=FakeSmtp).send(message)

    assert observed["connection"] == ("smtp.gmail.com", 465, 30)
    assert observed["login"] == ("career-alerts@example.com", "not-a-real-secret")
    assert observed["message"]["From"] == "career-alerts@example.com"
    assert observed["message"]["To"] == "recipient@example.com"
    assert observed["closed"] is True


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"sender": "a@example.com", "recipient": "b@example.com"},
        {"sender": "", "recipient": "b@example.com", "app_password": "x"},
    ],
)
def test_smtp_mailer_rejects_incomplete_config_without_connecting(tmp_path, payload):
    config_path = tmp_path / "email_config.json"
    config_path.write_text(json.dumps(payload))
    factory = SimpleNamespace(called=False)

    def smtp_factory(*_args, **_kwargs):
        factory.called = True
        raise AssertionError("must validate before connecting")

    with pytest.raises(ValueError, match="email config"):
        SmtpMailer(config_path=config_path, smtp_factory=smtp_factory).send(EmailMessage())

    assert factory.called is False
