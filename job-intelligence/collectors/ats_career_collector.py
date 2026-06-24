from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.company_targets import select_company_targets
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class AtsCareerPageCollector(Collector):
    source_name = "career_page"

    def __init__(self, timeout_seconds: int = 20) -> None:
        self.timeout_seconds = timeout_seconds

    def collect(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        errors: list[str] = []
        jobs: list[dict] = []

        targets = select_company_targets(
            request.company_target_limit,
            request.metadata.get("company_target_set", "default"),
        )
        if request.visa_friendly_only:
            targets = [target for target in targets if self._is_visa_friendly(target)]

        _BLOCKED_DOMAINS = {"metacareers.com"}

        for target in targets:
            url = target.get("career_url")
            if not url:
                continue
            domain = urlparse(url).netloc.lstrip("www.")
            if any(domain.endswith(b) for b in _BLOCKED_DOMAINS):
                continue
            try:
                target_jobs = self._collect_target(target, request)
                jobs.extend(target_jobs)
            except requests.RequestException as exc:
                logger.exception("career page request failed for %s", target["company"])
                errors.append(f"{target['company']}: career page request failed: {exc}")
            except Exception as exc:  # Career pages vary wildly; keep one bad target from killing the run.
                logger.exception("career page parsing failed for %s", target["company"])
                errors.append(f"{target['company']}: career page parsing failed: {exc}")

            if len(jobs) >= request.results_wanted:
                break

        if not jobs and not errors:
            errors.append("career pages returned no jobs for the selected company targets")

        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=deduplicate_jobs(jobs)[: request.results_wanted],
            errors=errors,
        )

    def _collect_target(self, target: dict, request: CollectionRequest) -> list[dict]:
        url = target["career_url"]
        parsed = urlparse(url)
        host = parsed.netloc.lower()
        path = parsed.path.strip("/")

        if "greenhouse.io" in host:
            board = path.split("/", 1)[0]
            return self._greenhouse_jobs(board, target, request)
        if "lever.co" in host:
            company = path.split("/", 1)[0]
            return self._lever_jobs(company, target, request)
        return self._html_jobs(url, target, request)

    def _greenhouse_jobs(self, board: str, target: dict, request: CollectionRequest) -> list[dict]:
        api_url = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true"
        data = self._get_json(api_url)
        jobs = []
        for item in data.get("jobs", []):
            job = self._make_job(
                target=target,
                title=item.get("title"),
                url=item.get("absolute_url"),
                location=self._location_name(item.get("location")) or request.location,
                description=item.get("content"),
                source_url=api_url,
                ats="greenhouse",
                external_id=str(item.get("id") or ""),
                date_posted=self._date_only(item.get("updated_at")),
            )
            if self._matches(job, request):
                jobs.append(job)
        return jobs

    def _lever_jobs(self, company: str, target: dict, request: CollectionRequest) -> list[dict]:
        api_url = f"https://api.lever.co/v0/postings/{company}?mode=json"
        data = self._get_json(api_url)
        jobs = []
        for item in data if isinstance(data, list) else []:
            categories = item.get("categories") or {}
            description = " ".join(
                str(value or "")
                for value in [item.get("descriptionPlain"), item.get("additionalPlain")]
            )
            job = self._make_job(
                target=target,
                title=item.get("text"),
                url=item.get("hostedUrl") or item.get("applyUrl"),
                location=categories.get("location") or request.location,
                description=description,
                source_url=api_url,
                ats="lever",
                external_id=str(item.get("id") or ""),
                job_type=categories.get("commitment"),
                date_posted=self._date_from_ms(item.get("createdAt")),
            )
            if self._matches(job, request):
                jobs.append(job)
        return jobs

    def _html_jobs(self, url: str, target: dict, request: CollectionRequest) -> list[dict]:
        response = requests.get(url, headers=self._headers(), timeout=self.timeout_seconds)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        jobs = []
        for link in soup.select("a[href]"):
            title = " ".join(link.get_text(" ", strip=True).split())
            href = link.get("href")
            if not title or not href or not self._looks_like_job_link(href, title):
                continue
            if href.startswith("/"):
                parsed = urlparse(url)
                href = f"{parsed.scheme}://{parsed.netloc}{href}"
            card = self._nearest_card(link)
            description = " ".join(card.get_text(" ", strip=True).split()) if card else title
            job = self._make_job(
                target=target,
                title=title,
                url=href,
                location=request.location,
                description=description,
                source_url=url,
                ats=self._platform_from_url(url),
                external_id=hashlib.sha1(href.encode()).hexdigest()[:16],
            )
            if self._matches(job, request):
                jobs.append(job)
            if len(jobs) >= request.results_wanted:
                break
        return jobs

    def _get_json(self, url: str):
        response = requests.get(url, headers=self._headers(), timeout=self.timeout_seconds)
        response.raise_for_status()
        return response.json()

    def _make_job(
        self,
        *,
        target: dict,
        title: str | None,
        url: str | None,
        location: str | None,
        description: str | None,
        source_url: str,
        ats: str,
        external_id: str,
        job_type: str | None = None,
        date_posted: str | None = None,
    ) -> dict:
        title = title or "Untitled role"
        url = url or target["career_url"]
        return {
            "id": f"career-{ats}-{external_id or hashlib.sha1(url.encode()).hexdigest()[:16]}",
            "site": self.source_name,
            "job_url": url,
            "job_url_direct": url,
            "title": title,
            "company": target["company"],
            "location": location,
            "description": self._clean_html(description),
            "job_type": job_type,
            "is_remote": self._is_remote(title, description, location),
            "date_posted": date_posted,
            "raw": {
                "ats": ats,
                "source_url": source_url,
                "company_target_rank": target["rank"],
                "company_target_career_url": target.get("career_url"),
                "sponsor_status": target.get("sponsor_status"),
                "h1b_or_funding": target.get("h1b_or_funding"),
            },
        }

    def _matches(self, job: dict, request: CollectionRequest) -> bool:
        text = " ".join(str(job.get(key) or "") for key in ("title", "description", "location", "job_type")).lower()
        terms = [term.lower() for term in re.findall(r"[A-Za-z0-9.#]+", request.search_term)]
        meaningful = [term for term in terms if term not in {"or", "and", "the", "in", "posted", "past"}]
        if meaningful and not any(term in text for term in meaningful):
            return False
        if request.is_remote and not job.get("is_remote"):
            return False
        if request.job_type:
            job_type_tokens = {
                "fulltime": ("full", "full-time", "full time"),
                "contract": ("contract", "contractor"),
                "c2c": ("c2c", "corp-to-corp", "corp to corp"),
                "w2": ("w2", "w-2"),
            }.get(request.job_type, (request.job_type,))
            if not any(token in text for token in job_type_tokens):
                return False
        return True

    @staticmethod
    def _is_visa_friendly(target: dict) -> bool:
        status = str(target.get("sponsor_status") or "").lower()
        h1b = str(target.get("h1b_or_funding") or "").lower()
        return any(token in status for token in ("strong", "active")) or bool(re.search(r"\d", h1b))

    @staticmethod
    def _headers() -> dict[str, str]:
        return {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
            ),
            "Accept": "application/json,text/html,application/xhtml+xml",
        }

    @staticmethod
    def _location_name(value) -> str | None:
        if isinstance(value, dict):
            return value.get("name")
        return value

    @staticmethod
    def _date_only(value: str | None) -> str | None:
        if not value:
            return None
        return value[:10]

    @staticmethod
    def _date_from_ms(value) -> str | None:
        if not value:
            return None
        try:
            return datetime.fromtimestamp(value / 1000).date().isoformat()
        except (TypeError, ValueError, OSError):
            return None

    @staticmethod
    def _clean_html(value: str | None) -> str | None:
        if not value:
            return None
        return " ".join(BeautifulSoup(value, "html.parser").get_text(" ", strip=True).split())

    @staticmethod
    def _is_remote(title: str | None, description: str | None, location: str | None) -> bool:
        text = " ".join(str(value or "") for value in (title, description, location)).lower()
        return "remote" in text

    @staticmethod
    def _looks_like_job_link(href: str, title: str) -> bool:
        value = f"{href} {title}".lower()
        return any(token in value for token in ("/job", "jobid", "job_id", "opening", "position", "requisition"))

    @staticmethod
    def _nearest_card(link):
        for parent in link.parents:
            if parent.name in {"article", "li", "section", "div"}:
                text = parent.get_text(" ", strip=True)
                if len(text) > 30:
                    return parent
        return None

    @staticmethod
    def _platform_from_url(url: str) -> str:
        host = urlparse(url).netloc.lower()
        if "workdayjobs.com" in host:
            return "workday"
        if "ashbyhq.com" in host:
            return "ashby"
        if "smartrecruiters.com" in host:
            return "smartrecruiters"
        if "icims.com" in host:
            return "icims"
        return "html"
