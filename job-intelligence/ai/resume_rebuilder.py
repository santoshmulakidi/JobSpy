from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any


def compute_ats_score(resume_text: str, job_description: str) -> int:
    """Simple keyword-match ATS score (0–100). Counts JD tokens found in resume."""
    if not resume_text or not job_description:
        return 0
    _stop = {
        "a", "an", "the", "and", "or", "of", "in", "to", "for", "with", "on",
        "at", "by", "as", "is", "are", "was", "were", "be", "been", "will",
        "we", "you", "our", "your", "us", "this", "that", "it", "its", "from",
        "have", "has", "had", "do", "does", "not", "but", "if", "any", "all",
        "can", "may", "must", "shall", "should", "would", "could", "more",
        "other", "also", "than", "into", "they", "their", "them", "both",
        "new", "use", "using", "used", "well", "make", "work", "team",
    }
    def _tokens(text: str) -> set[str]:
        words = re.findall(r"[a-zA-Z][a-zA-Z0-9+#.\-]{1,}", text.lower())
        return {w for w in words if w not in _stop and len(w) > 2}

    jd_tokens = _tokens(job_description)
    if not jd_tokens:
        return 0
    resume_lower = resume_text.lower()
    matched = sum(1 for t in jd_tokens if t in resume_lower)
    return min(100, round(matched / len(jd_tokens) * 100))

import httpx

from storage.config import Settings

_log = logging.getLogger(__name__)

_CANONICAL_SECTION_ORDER = [
    "PROFESSIONAL SUMMARY",
    "CORE STRENGTHS",
    "TECHNICAL SKILLS",
    "PROFESSIONAL EXPERIENCE",
    "EDUCATION",
]

_SECTION_ALIASES = {
    "PROFESSIONAL SUMMARY": {"professional summary", "summary", "profile", "objective"},
    "CORE STRENGTHS": {"core strengths", "core competencies", "strengths"},
    "TECHNICAL SKILLS": {"technical skills", "skills", "technologies"},
    "PROFESSIONAL EXPERIENCE": {"professional experience", "experience", "work experience", "employment history"},
    "EDUCATION": {"education", "educational details", "academic details"},
}

_ALL_SECTION_ALIASES = {alias for aliases in _SECTION_ALIASES.values() for alias in aliases}


@dataclass(frozen=True)
class ResumeRebuildResult:
    provider: str
    model: str | None
    rebuilt_resume: str
    change_summary: list[str]
    warnings: list[str]
    prompt: str


def rebuild_resume(
    *,
    base_resume: str,
    job_description: str,
    profile_name: str | None,
    target_title: str | None,
    provider: str | None = None,
    model: str | None = None,
    refine_instruction: str | None = None,
    settings: Settings,
) -> ResumeRebuildResult:
    prompt = build_resume_prompt(
        base_resume=base_resume,
        job_description=job_description,
        profile_name=profile_name,
        target_title=target_title,
    )
    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                "You are a Senior Technical Recruiter and ATS specialist with 15+ years screening candidates "
                "through Workday, iCIMS, Greenhouse, and LinkedIn Recruiter. You know exactly which resume "
                "patterns get filtered out before human eyes ever see them. You understand both the machine "
                "parsing layer and what hiring managers actually want to see after the ATS passes the resume.\n\n"
                "ABSOLUTE RULES — never break these:\n"
                "- Output plain text only. No markdown, no asterisks (*), no bold (**), no italics, no headers (#).\n"
                "- Do not invent employers, dates, degrees, certifications, metrics, tools, or experience.\n"
                "- If a JD requirement is not in the candidate's background, list it as a gap, do not add it.\n"
                "- Use the exact spelling and phrasing from the job description for every skill, tool, and methodology.\n"
                "- Every keyword in the JD that exists in the candidate's background MUST appear in the output.\n\n"
                "ATS PRESERVATION RULES:\n"
                "- The rewritten resume must not be shorter than a normal full resume. Do not summarize the candidate into a short profile.\n"
                "- Preserve the candidate's Contact Information, Summary, Technical Skills, Professional Experience, and Education sections.\n"
                "- Preserve all truthful exact-match terms already present in the base resume, including Software Development Life Cycle, Agile Methodologies, Cloud Computing, Database Management Systems, Debugging, DevSecOps, Software Testing, Version Control Management, documentation, requirements, quality, technical, engineering, delivery, tools, and problem-solving when relevant to the JD.\n"
                "- If the base resume has a matching acronym and the JD has a full phrase, include both, for example Software Development Life Cycle (SDLC) or Continuous Integration/Continuous Delivery (CI/CD).\n\n"
                "MANDATORY RESUME FORMAT:\n"
                "- Use this section order only: name, target headline, contact line, PROFESSIONAL SUMMARY, CORE STRENGTHS, TECHNICAL SKILLS, PROFESSIONAL EXPERIENCE, EDUCATION.\n"
                "- Use all-caps section headings exactly as written above.\n"
                "- Experience entries must use this pattern: Role | Company | Location, next line dates, optional Project line, then concise bullets, then optional Environment line.\n"
                "- Do not output a different resume format, table format, markdown format, or paragraph-only resume.\n\n"
                "WRITING STYLE — anti-AI-detection rules (these are critical — AI detectors flag 80%+ of AI resumes on these patterns):\n"
                "- No em dashes (-- or —). Use a comma, colon, or new sentence.\n"
                "- No AI vocabulary: avoid pivotal, leverage, showcase, foster, utilize, spearhead, vibrant, testament, underscore, groundbreaking, robust, seamless, revolutionize, transformative, innovative, delivering scalable solutions, high-quality solutions, adept, proficient in, passionate about, results-driven, detail-oriented, dynamic, synergy, ecosystem, best-in-class.\n"
                "- Active voice: 'Built X' not 'X was built', 'Reduced latency' not 'Latency was reduced'.\n"
                "- VARY bullet length deliberately: mix short (8-12 words) and longer (18-25 word) bullets within each role. Never let 3 consecutive bullets be the same length.\n"
                "- VARY bullet structure: not every bullet should follow '[Verb] [tech] to [outcome]'. Some bullets can start with context ('When the team needed X, built Y'), some can be compound ('Designed the schema and wrote the migration scripts'), some can lead with the constraint ('Under a 6-week deadline, delivered ...').\n"
                "- Vary action verbs aggressively: built, wrote, designed, cut, migrated, shipped, debugged, refactored, integrated, wired up, set up, replaced, reduced, consolidated, extended, ported, connected, automated, validated, tested, reviewed, documented, configured, deployed, diagnosed.\n"
                "- No uniform parallel structure across bullets within a role — this is the single biggest AI tell.\n"
                "- No generic openers per role: the first bullet of each role must reference the specific product, team, or constraint — not a generic architecture description.\n"
                "- Professional Summary: write 3 sentences maximum. Lead with a concrete technical claim, not a career philosophy. Do not start with the candidate's name or 'I'.\n"
                "- No generic conclusions or mission statements anywhere in the resume.\n"
                "- Numbers and metrics only when the source resume supports them; do not fabricate percentages.\n"
                "- Occasionally drop a filler word or use a contraction mid-bullet to break uniformity (e.g., 'didn't need', 'it wasn't').\n"
                "- Read the final output aloud mentally. If every bullet sounds like it came from the same template, rewrite until they don't."
            ),
        },
        {"role": "user", "content": prompt},
    ]
    if refine_instruction and refine_instruction.strip():
        messages.append({
            "role": "user",
            "content": (
                f"Refine the resume you just produced with this instruction: {refine_instruction.strip()}\n"
                "Keep all employers, dates, and facts unchanged. "
                "Apply the same writing rules: no em dashes, no AI vocabulary (leverage, utilize, spearhead, robust, seamless, pivotal, transformative, results-driven, passionate, proven), active voice only. "
                "Critical: vary bullet length and structure — mix short (8-12 word) and longer (18-25 word) bullets, and vary the opening pattern so not every bullet starts with [Verb] [tech]. "
                "Never write 'Designed and implemented' or 'Developed and maintained'. "
                "Do not fabricate any facts. "
                "Make it sound recruiter-authentic by reducing generic AI-style wording, varying sentence structure, and adding real-world technical context only where supported by the base resume. "
                "Return the same three sections in the same order: REVISED RESUME, CHANGE SUMMARY, KEYWORD GAPS."
            ),
        })

    providers = _provider_order(settings, selected_provider=provider, selected_model=model)
    provider_errors: list[str] = []
    for p in providers:
        try:
            text = _chat_completion(provider=p, messages=messages, settings=settings)
            extracted = _extract_tailored_resume(text)
            repaired = _repair_incomplete_resume(rebuilt_resume=extracted, base_resume=base_resume)
            label = p["name"]
            if p.get("key_index") and len(settings.gemini_api_keys) > 1:
                label = f"{p['name']} (key {p['key_index']})"
            return ResumeRebuildResult(
                provider=label,
                model=p["model"],
                rebuilt_resume=repaired,
                change_summary=_extract_section(text, "Change Summary"),
                warnings=_extract_section(text, "Warnings"),
                prompt=prompt,
            )
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            if code in (429, 503, 529):
                key_info = f" (key {p['key_index']})" if p.get("key_index") else ""
                label = "rate limit" if code == 429 else "service unavailable"
                provider_errors.append(f"{p['name']}{key_info}: {label} ({code}), trying next")
                continue
            provider_errors.append(f"{p['name']}: {exc}")
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            provider_errors.append(f"{p['name']}: {exc}")

    return ResumeRebuildResult(
        provider="prompt_only",
        model=None,
        rebuilt_resume=_fallback_resume_prompt(prompt),
        change_summary=["No AI provider key configured or all configured providers failed."],
        warnings=provider_errors or ["Configure OpenRouter or NVIDIA API keys to generate a rebuilt resume."],
        prompt=prompt,
    )


def build_resume_prompt(
    *,
    base_resume: str,
    job_description: str,
    profile_name: str | None,
    target_title: str | None,
) -> str:
    employers = _list_base_employers(base_resume)
    employer_count = len(employers)
    employer_line = (
        f"The base resume contains {employer_count} employers/roles, in this exact order:\n"
        + "\n".join(f"  {idx}. {name}" for idx, name in enumerate(employers, start=1))
        + f"\nYour PROFESSIONAL EXPERIENCE section MUST contain all {employer_count} of these roles, "
        "in the same order, each with its own Role/Company/Location line, Dates line, Project line, "
        "achievement bullets, and Environment line. Do not merge, summarize, or drop any role."
        if employer_count
        else "Include every employer and role from the base resume. Do not drop any."
    )

    # Pre-compute missing JD keywords so the model injects them on the first pass
    missing_keywords = _extract_jd_keywords_to_inject(base_resume, job_description)
    if missing_keywords:
        keyword_inject_section = (
            "MANDATORY KEYWORD INJECTION — these JD keywords are missing from the base resume but ARE "
            "present in the candidate's likely background (standard technologies for this role). "
            "You MUST weave every one of these into the rebuilt resume wherever truthfully applicable "
            "(TECHNICAL SKILLS, role bullets, or Environment lines). Do NOT add any that the candidate "
            "has clearly never used:\n"
            + "\n".join(f"  • {kw}" for kw in missing_keywords)
        )
    else:
        keyword_inject_section = ""

    return f"""Rebuild this resume to score 85%+ on ATS keyword matching for the target job. Preserve all facts exactly — no invented employers, dates, metrics, tools, or credentials.

Profile: {profile_name or "Not specified"}
Target title/company: {target_title or "Not specified"}

{employer_line}

Base Resume:
{base_resume.strip()}

{_jd_section(job_description)}

{keyword_inject_section}

---

OUTPUT FORMAT — output these three sections in this exact order:

REVISED RESUME
The complete rewritten resume in plain text using this format only:
NAME IN ALL CAPS
Target headline with role and major technologies
City, State | email | phone | LinkedIn

PROFESSIONAL SUMMARY
One concise paragraph.

CORE STRENGTHS
Three compact lines of strength phrases separated by "   ·   ".

TECHNICAL SKILLS
Grouped skills using short category labels and comma-separated values.

PROFESSIONAL EXPERIENCE
(Repeat the following block once for EVERY employer in the base resume, in the same order. If the base has 7 employers, output 7 blocks.)
Role | Company | Location
Dates
Project: Project name or brief domain context
- Achievement bullet
- Achievement bullet
Environment: technologies

EDUCATION
Each degree on its own line using this exact format: Degree Name, Field | University Name, Location | Year
Example: Master of Science, Computer Science | Northwestern Polytechnic University, Fremont, CA | 2016

CRITICAL: Include every section from the original: contact info, summary, skills, EVERY work experience employer with all dates intact, education, certifications. Do not drop, merge, or summarize any employer or role. The number of employer blocks in your output must equal the number in the base resume.
ATS rules for this section:
- Mirror every JD keyword verbatim (if JD says "DevSecOps", write "DevSecOps", not "secure development")
- Every skill, tool, and methodology from the JD that exists in the candidate background must appear
- Preserve exact-match base resume keywords that already help the score. Do not replace exact JD phrases with only acronyms or synonyms.
- Keep the Technical Skills section broad enough to preserve truthful technologies from the base resume. Do not shrink it to only a few skills.
- Also weave in these common high-value JD nouns wherever truthful: requirements, quality, technical, engineering, delivery, tools, problem-solving, documentation, lifecycle, modern, design, architecture. Use the exact JD spelling.
- ALWAYS carry the candidate EDUCATION section forward exactly as written in the base resume (degree, field of study, university). Never move the candidate existing degree to the KEYWORD GAPS section. If the base resume shows a Bachelor or Master, the revised resume must show it too.
- Plain text only, no markdown, no asterisks, no bold, no bullet symbols like * or **
- Varied action verbs: built, designed, reduced, automated, migrated, led, shipped, integrated
- No em dashes. No AI vocabulary: leverage, utilize, spearhead, robust, seamless, pivotal, transformative

ATS SCORE TARGET — reach 90%+:
- Every skill, tool, methodology, and phrase from the JD that the candidate actually has must appear verbatim in the resume.
- Mirror exact JD phrasing: if JD says "event-driven architecture", write "event-driven architecture", not just "event-driven".
- Front-load the highest-frequency JD keywords in the TECHNICAL SKILLS section and again inside the two most recent role bullets.
- Do not replace multi-word JD phrases with only acronyms. Keep both: "Continuous Integration/Continuous Delivery (CI/CD)".

Humanize / Recruiter Authentic Rewrite rules:
- Reduce generic AI-style wording and make the resume read like a real recruiter-ready technical resume.
- Add real-world technical context where supported by the base resume, including domains, system names, integrations, constraints, deadlines, cloud services, databases, CI/CD pipelines, testing, UAT, migrations, and production support.
- Keep ATS keywords, but make them read naturally inside truthful project context.
- Do not fabricate metrics, employers, dates, tools, or project names. Also do not fabricate cloud services, visa status, responsibilities, or business results.

Humanize / anti-AI-detection rules — AI detectors flag uniform structure; breaking these specifically reduces detection:
- Do NOT make all bullets the same length or the same sentence structure. Mix short punchy bullets with longer contextual ones inside every role.
- Do NOT use the same action verb to start more than 2 bullets across the whole resume.
- Do NOT write "Designed and implemented" or "Developed and maintained" — these are the most flagged AI phrases.
- Remove all buzzwords: scalable solutions, high-quality solutions, modern engineering practices, strong background, proven ability, best practices, industry-standard, cutting-edge, state-of-the-art.
- At least 2 bullets per role must reference a specific system name, team name, integration, constraint, or deadline from the base resume — not a generic architecture pattern.
- The professional summary must make one concrete claim about the candidate's actual domain and one real technical achievement. No mission statements.
- Vary ending structures: not every bullet ends with a technology name or a result. Some can end mid-thought if that's how the work actually was.
- Do not fabricate metrics, employers, dates, tools, project names, cloud services, visa status, or business results.

Content quality recruiter self-check before returning:
- Read each role's bullets. If they all follow the same [Verb] [tech] for [generic outcome] pattern, rewrite half of them to be structurally different.
- Confirm no verb appears as a bullet opener more than twice total across the whole resume.
- Confirm the summary is 3 sentences or fewer and does not contain the words "passionate", "driven", "results-oriented", or "leverage".

CHANGE SUMMARY
3 to 5 plain-text bullet points (no asterisks) explaining what changed and why it will rank higher.

KEYWORD GAPS
Plain list of JD keywords and phrases NOT in the candidate background that could not be added. Only list true gaps (skills or tools the candidate has never used). Do NOT list anything already present in the base resume, and never list the candidate degree, education, or years of experience here. Flag [EXACT PHRASE] if the JD uses a specific multi-word term that must appear verbatim when the candidate adds it later.
"""


def _extract_jd_keywords_to_inject(base_resume: str, job_description: str) -> list[str]:
    """Return JD keywords that exist in the resume candidate pool but are absent from the base resume text.

    These are handed to the model as a MUST-INCLUDE list so the first rebuild hits 85%+ ATS
    without needing multiple refinement passes.
    """
    # Same tech list the frontend uses — keep in sync conceptually
    KNOWN_SKILLS = [
        # languages
        "C#", "Java", "Python", "JavaScript", "TypeScript", "SQL", "T-SQL", "HTML", "CSS",
        "HTML5", "CSS3", "VB.NET", "PowerShell", "Bash",
        # .NET
        "ASP.NET", "ASP.NET Core", "ASP.NET MVC", ".NET", ".NET Core", ".NET 6", ".NET 7", ".NET 8",
        "Entity Framework", "LINQ", "ADO.NET", "WCF", "Web API", "Razor", "Blazor", "SignalR",
        "Minimal API",
        # frontend
        "React", "Angular", "Vue", "Next.js", "Redux", "Webpack", "SASS", "Bootstrap",
        "jQuery", "AJAX", "Tailwind",
        # cloud / azure
        "Azure", "AWS", "GCP", "Azure App Service", "Azure Functions", "Azure SQL", "Azure DevOps",
        "Azure AD", "Azure Active Directory", "Azure Key Vault", "Azure Service Bus",
        "Azure Event Grid", "Azure Monitor", "Azure Pipelines", "Azure Container",
        "Azure Kubernetes", "ARM Templates", "Bicep", "APIM", "API Management",
        "Application Insights",
        # devops
        "Docker", "Kubernetes", "Jenkins", "GitHub Actions", "CI/CD", "DevOps", "DevSecOps",
        "Terraform", "Ansible", "Helm", "Git", "GitHub", "Bitbucket", "Azure Repos",
        # security
        "OAuth", "OAuth 2.0", "JWT", "OpenID Connect", "OWASP", "RBAC",
        "Role-Based Access Control", "Azure AD B2C", "Zero Trust", "SSL", "TLS",
        # databases
        "SQL Server", "PostgreSQL", "MySQL", "Oracle", "MongoDB", "Redis", "SQLite",
        "Cosmos DB", "Elasticsearch", "NoSQL",
        # methodologies
        "Agile", "Scrum", "Kanban", "SDLC", "TDD", "BDD", "Microservices", "RESTful",
        "REST API", "SOAP", "gRPC", "Event-Driven Architecture", "Domain-Driven Design",
        "SOLID", "Clean Architecture", "Design Patterns",
        # tools
        "Visual Studio", "VS Code", "JIRA", "Confluence", "Postman", "Swagger", "OpenAPI",
        "SonarQube", "Serilog", "NUnit", "xUnit", "Moq", "Selenium", "Playwright",
        # reporting
        "Power BI", "SSRS", "SSIS", "Crystal Reports", "Tableau",
        # general
        "Software Development Life Cycle", "Continuous Integration", "Continuous Delivery",
        "Continuous Deployment", "Infrastructure as Code", "Load Balancing",
        "High Availability", "Disaster Recovery", "Unit Testing", "Integration Testing",
        "Code Review", "Pair Programming", "Technical Documentation",
        "Object-Oriented Programming", "Functional Programming",
        "Event-Driven", "Message Queue", "RabbitMQ", "Apache Kafka",
        "Spring Boot", "Hibernate", "Maven", "Gradle",
        "Node.js", "Express", "FastAPI", "Flask", "Django",
        "Microservice", "Serverless", "Cloud Native", "Multi-Tenant",
        "On-Premises", "Hybrid Cloud", "Cross-Functional",
    ]

    jd_lower = job_description.lower()
    resume_lower = base_resume.lower()

    missing: list[str] = []
    for skill in KNOWN_SKILLS:
        skill_lower = skill.lower()
        if skill_lower in jd_lower and skill_lower not in resume_lower:
            missing.append(skill)

    # Also extract quoted or capitalised multi-word phrases from JD not in resume
    # e.g. "event-driven architecture", "distributed systems"
    extra_phrases = re.findall(r'"([^"]{4,60})"', job_description)
    for phrase in extra_phrases:
        if phrase.lower() in jd_lower and phrase.lower() not in resume_lower:
            missing.append(phrase)

    # De-dup preserving order, cap at 30 to avoid overwhelming the model
    seen: set[str] = set()
    result: list[str] = []
    for item in missing:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result[:30]


def _jd_section(job_description: str) -> str:
    jd = job_description.strip() if job_description else ""
    if jd:
        return f"Job Description:\n{jd}"
    return (
        "Job Description: Not available.\n"
        "Tailor this resume based on the target title and common senior-level requirements "
        "for that role. Emphasize relevant skills from the base resume. "
        "Note in Warnings that no job description was provided."
    )


def _provider_order(
    settings: Settings,
    *,
    selected_provider: str | None = None,
    selected_model: str | None = None,
) -> list[dict[str, str]]:
    providers: list[dict[str, str]] = []
    default_order = [item.strip().lower() for item in settings.ai_provider_order.split(",") if item.strip()]
    # Selected provider goes first; remaining default order appended as automatic fallbacks.
    if selected_provider:
        primary = selected_provider.strip().lower()
        preferred = [primary] + [n for n in default_order if n != primary]
    else:
        preferred = default_order
    for name in preferred:
        if name == "openrouter" and settings.openrouter_api_key:
            providers.append(
                {
                    "name": "openrouter",
                    "base_url": settings.openrouter_base_url.rstrip("/"),
                    "api_key": settings.openrouter_api_key,
                    "model": selected_model or settings.openrouter_model,
                }
            )
        elif name == "nvidia" and settings.nvidia_api_key:
            providers.append(
                {
                    "name": "nvidia",
                    "base_url": settings.nvidia_base_url.rstrip("/"),
                    "api_key": settings.nvidia_api_key,
                    "model": selected_model or settings.nvidia_model,
                }
            )
        elif name == "groq" and settings.groq_api_key:
            providers.append(
                {
                    "name": "groq",
                    "base_url": settings.groq_base_url.rstrip("/"),
                    "api_key": settings.groq_api_key,
                    "model": selected_model or settings.groq_model,
                }
            )
        elif name == "gemini":
            for idx, key in enumerate(settings.gemini_api_keys):
                providers.append(
                    {
                        "name": "gemini",
                        "base_url": settings.gemini_base_url.rstrip("/"),
                        "api_key": key,
                        "model": selected_model or settings.gemini_model,
                        "key_index": str(idx + 1),
                    }
                )
    return providers


def _chat_completion(*, provider: dict[str, str], messages: list[dict[str, str]], settings: Settings) -> str:
    if provider["name"] == "gemini":
        return _gemini_completion(provider=provider, messages=messages, settings=settings)

    headers = {
        "Authorization": f"Bearer {provider['api_key']}",
        "Content-Type": "application/json",
    }
    if provider["name"] == "openrouter":
        headers["HTTP-Referer"] = settings.openrouter_site_url
        headers["X-Title"] = settings.openrouter_app_name

    response = httpx.post(
        f"{provider['base_url']}/chat/completions",
        headers=headers,
        json={
            "model": provider["model"],
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": settings.resume_rebuild_max_tokens,
        },
        timeout=settings.ai_request_timeout_seconds,
    )
    response.raise_for_status()
    data = response.json()
    return _message_content(data)


def _gemini_completion(*, provider: dict[str, str], messages: list[dict[str, str]], settings: Settings) -> str:
    system_text = "\n".join(message["content"] for message in messages if message["role"] == "system")
    user_text = "\n\n".join(message["content"] for message in messages if message["role"] != "system")
    response = httpx.post(
        f"{provider['base_url']}/models/{provider['model']}:generateContent",
        params={"key": provider["api_key"]},
        headers={"Content-Type": "application/json"},
        json={
            "systemInstruction": {"parts": [{"text": system_text}]},
            "contents": [{"role": "user", "parts": [{"text": user_text}]}],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": settings.resume_rebuild_max_tokens,
            },
        },
        timeout=settings.ai_request_timeout_seconds,
    )
    response.raise_for_status()
    data = response.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError) as exc:
        raise ValueError("Gemini returned an unsupported response format") from exc
    return "\n".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()


def _message_content(data: dict[str, Any]) -> str:
    content = data["choices"][0]["message"]["content"]
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and item.get("type") in {None, "text"}
        )
    raise ValueError("AI provider returned an unsupported message format")


def _extract_tailored_resume(text: str) -> str:
    """Extract the resume section from the structured output."""
    lowered = text.lower()
    for marker in ["revised resume\n", "revised resume:", "tailored resume\n", "tailored resume:"]:
        pos = lowered.find(marker)
        if pos != -1:
            after = text[pos + len(marker):]
            after_lowered = after.lower()
            end_positions = [
                after_lowered.find(m) for m in ["change summary", "keyword gaps", "warnings"]
                if after_lowered.find(m) > 0
            ]
            if end_positions:
                return after[: min(end_positions)].strip()
            return after.strip()

    # No section markers — model returned a plain resume
    return text.strip()


def _extract_section(text: str, heading: str) -> list[str]:
    lowered = text.lower()
    # Map legacy heading names to what the new prompt outputs
    search_terms: dict[str, list[str]] = {
        "change summary": ["change summary"],
        "warnings": ["keyword gaps", "warnings"],
    }
    candidates = search_terms.get(heading.lower(), [heading.lower()])
    stop_terms = ["revised resume", "change summary", "keyword gaps", "warnings"]

    for candidate in candidates:
        pos = lowered.find(candidate)
        if pos == -1:
            continue
        section = text[pos + len(candidate):]
        sec_lower = section.lower()
        end_positions = [sec_lower.find(s) for s in stop_terms if sec_lower.find(s) > 0]
        if end_positions:
            section = section[: min(end_positions)]
        lines = [
            line.strip(" -:\t*#123.")
            for line in section.splitlines()
            if line.strip(" -:\t*#123.")
        ]
        return lines[:20]

    return []


def _normalized_heading(line: str) -> str:
    return line.strip().strip("#*").rstrip(":").strip().lower()


def _canonical_heading(line: str) -> str | None:
    normalized = _normalized_heading(line)
    for heading, aliases in _SECTION_ALIASES.items():
        if normalized in aliases:
            return heading
    return None


def _split_resume_sections(text: str) -> tuple[list[str], dict[str, list[str]]]:
    header: list[str] = []
    sections: dict[str, list[str]] = {}
    current_heading: str | None = None

    for raw in text.strip().splitlines():
        line = raw.rstrip()
        heading = _canonical_heading(line)
        if heading:
            current_heading = heading
            sections.setdefault(heading, [])
            continue

        if current_heading:
            sections[current_heading].append(line)
        else:
            header.append(line)

    return header, sections


def _extract_base_section(base_resume: str, canonical_heading: str) -> list[str]:
    aliases = _SECTION_ALIASES[canonical_heading]
    lines = base_resume.strip().splitlines()
    start: int | None = None

    for index, line in enumerate(lines):
        if _normalized_heading(line) in aliases:
            start = index + 1
            break

    if start is None:
        return []

    end = len(lines)
    for index in range(start, len(lines)):
        normalized = _normalized_heading(lines[index])
        if normalized in _ALL_SECTION_ALIASES:
            end = index
            break

    return [line.rstrip() for line in lines[start:end] if line.strip()]


def _section_is_weak(lines: list[str], *, minimum_chars: int) -> bool:
    text = "\n".join(line.strip() for line in lines).strip()
    if len(text) < minimum_chars:
        return True
    compact = re.sub(r"[\s.,;:|/\\-]+", "", text)
    return len(compact) < 12


_DATE_LINE_RE = re.compile(
    r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}",
    re.I,
)


def _count_employers(lines: list[str]) -> int:
    """Count distinct job entries by their month-year date lines."""
    return sum(1 for line in lines if _DATE_LINE_RE.search(line))


def _list_base_employers(base_resume: str) -> list[str]:
    """Return the Role | Company headers of every employer in the base resume."""
    exp_lines = _extract_base_section(base_resume, "PROFESSIONAL EXPERIENCE")
    employers: list[str] = []
    for index, line in enumerate(exp_lines):
        if "|" not in line:
            continue
        # A role header is immediately followed (within 2 lines) by a date line
        lookahead = exp_lines[index + 1 : index + 3]
        if any(_DATE_LINE_RE.search(nxt) for nxt in lookahead):
            parts = [p.strip() for p in re.split(r"\s+\|\s+", line) if p.strip()]
            # Role | Company is the most useful identifier
            employers.append(" | ".join(parts[:2]) if len(parts) >= 2 else line.strip())
    return employers


def _repair_incomplete_resume(*, rebuilt_resume: str, base_resume: str) -> str:
    """Restore required sections if a model returns a partial or collapsed resume."""
    header, sections = _split_resume_sections(rebuilt_resume)
    base_fallbacks = {
        "PROFESSIONAL SUMMARY": _extract_base_section(base_resume, "PROFESSIONAL SUMMARY"),
        "TECHNICAL SKILLS": _extract_base_section(base_resume, "TECHNICAL SKILLS"),
        "PROFESSIONAL EXPERIENCE": _extract_base_section(base_resume, "PROFESSIONAL EXPERIENCE"),
        "EDUCATION": _extract_base_section(base_resume, "EDUCATION"),
    }

    minimums = {
        "PROFESSIONAL SUMMARY": 120,
        "CORE STRENGTHS": 40,
        "TECHNICAL SKILLS": 120,
        "PROFESSIONAL EXPERIENCE": 500,
        "EDUCATION": 25,
    }

    for heading in _CANONICAL_SECTION_ORDER:
        current = sections.get(heading, [])
        if not _section_is_weak(current, minimum_chars=minimums[heading]):
            continue
        fallback = base_fallbacks.get(heading, [])
        if fallback:
            sections[heading] = fallback

    # Safety net: if the model dropped employers (e.g. returned 1 of 7 jobs),
    # restore the full base experience so no work history is lost.
    base_exp = base_fallbacks.get("PROFESSIONAL EXPERIENCE", [])
    rebuilt_exp = sections.get("PROFESSIONAL EXPERIENCE", [])
    if base_exp and _count_employers(rebuilt_exp) < _count_employers(base_exp):
        sections["PROFESSIONAL EXPERIENCE"] = base_exp

    # If the model collapsed after TECHNICAL SKILLS, this reconstruction keeps
    # the good rewritten header/summary but restores the base resume substance.
    output: list[str] = [line for line in header if line.strip()]
    for heading in _CANONICAL_SECTION_ORDER:
        lines = [line for line in sections.get(heading, []) if line.strip()]
        if not lines:
            continue
        if output:
            output.append("")
        output.append(heading)
        output.extend(lines)

    repaired = "\n".join(output).strip()
    return repaired or rebuilt_resume.strip()


def _fallback_resume_prompt(prompt: str) -> str:
    return (
        "AI provider is not configured. Copy this prompt into OpenRouter, NVIDIA Chat, Claude, ChatGPT, "
        "or Gemini to rebuild the resume.\n\n"
        f"{prompt}"
    )
