from __future__ import annotations

import io
import re

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

# Section headings commonly found in resumes (matched case-insensitively on
# short all-caps-ish lines so body text never gets promoted to a heading)
_SECTION_WORDS = (
    "professional summary", "summary", "objective", "profile", "technical skills", "skills", "core strengths", "core competencies",
    "experience", "work experience", "professional experience", "employment history",
    "education", "certifications", "certification", "projects", "achievements", "awards",
    "publications", "languages", "keyword gaps", "interests",
)

_BLUE = RGBColor(0x00, 0x70, 0xC0)
_BODY = RGBColor(0x1F, 0x1F, 0x1F)
_GRAY = RGBColor(0x77, 0x77, 0x77)
_HEADER_GRAY = RGBColor(0x59, 0x59, 0x59)

_TECHNICAL_SKILL_ROWS = (
    ("Languages", "C#, TypeScript, JavaScript, Python, T-SQL, PowerShell"),
    ("Backend", ".NET 6/7/8, ASP.NET Core Web API, Entity Framework Core, REST APIs, Microservices, gRPC, WCF"),
    ("Frontend", "React 18 (Hooks, Redux Toolkit), Angular, TypeScript, HTML5, CSS3, Bootstrap, SASS"),
    ("Azure", "App Service, Azure Functions, Azure SQL, Service Bus, Event Grid, Key Vault, Azure AD, APIM, Azure Monitor, Application Insights, Azure Container Registry"),
    ("DevOps", "Azure DevOps (YAML Pipelines), GitHub Actions, Docker, Kubernetes, ARM Templates, Bicep, SonarQube"),
    ("Security", "OAuth 2.0, OpenID Connect, JWT, Azure AD, RBAC, OWASP Secure API Design, Data Encryption"),
    ("Data", "SQL Server 2014-2022, Azure SQL, Entity Framework Core, ADO.NET, Redis, SSIS, SSRS, Power BI"),
    ("AI / GenAI", "Azure OpenAI Service, Semantic Kernel, GitHub Copilot, RAG concepts, LLM-based automation prototypes"),
    ("Testing", "NUnit, xUnit, MSTest, Moq, TDD, Integration Testing, Load Testing"),
)


def resume_only_text(text: str) -> str:
    """Remove non-resume review sections before preview/export."""
    lines = text.strip().splitlines()
    stop_headings = {"change summary", "keyword gaps", "warnings"}
    kept: list[str] = []
    for line in lines:
        normalized = line.strip().rstrip(":").strip().lower()
        if normalized in stop_headings:
            break
        kept.append(line)
    return "\n".join(kept).strip()


def _is_section_heading(line: str) -> bool:
    stripped = line.strip().rstrip(":").strip()
    if not stripped or len(stripped) > 60:
        return False
    lowered = stripped.lower()
    if lowered in _SECTION_WORDS:
        return True
    return False


def _is_bullet(line: str) -> bool:
    return bool(re.match(r"^\s*[-•*o]\s+", line))


def _format_run(run, *, size: float = 9.4, color: RGBColor = _BODY, bold: bool | None = None, italic: bool | None = None):
    run.font.name = "Arial"
    run.font.size = Pt(size)
    run.font.color.rgb = color
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    return run


def _set_xml_attr(element, name: str, value: str):
    element.set(qn(f"w:{name}"), value)


def _set_table_width_and_borders(table):
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.insert(0, tbl_w)
    _set_xml_attr(tbl_w, "w", "9360")
    _set_xml_attr(tbl_w, "type", "dxa")

    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        element = borders.find(qn(f"w:{edge}"))
        if element is None:
            element = OxmlElement(f"w:{edge}")
            borders.append(element)
        _set_xml_attr(element, "val", "single")
        _set_xml_attr(element, "sz", "4")
        _set_xml_attr(element, "space", "0")
        _set_xml_attr(element, "color", "auto")

    cell_mar = tbl_pr.find(qn("w:tblCellMar"))
    if cell_mar is None:
        cell_mar = OxmlElement("w:tblCellMar")
        tbl_pr.append(cell_mar)
    for side in ("left", "right"):
        margin = cell_mar.find(qn(f"w:{side}"))
        if margin is None:
            margin = OxmlElement(f"w:{side}")
            cell_mar.append(margin)
        _set_xml_attr(margin, "w", "10")
        _set_xml_attr(margin, "type", "dxa")


def _set_cell_width(cell, width: int):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.tcW
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    _set_xml_attr(tc_w, "w", str(width))
    _set_xml_attr(tc_w, "type", "dxa")


def _set_cell_text(cell, text: str, *, bold: bool | None = None):
    paragraph = cell.paragraphs[0]
    for run in list(paragraph.runs):
        paragraph._p.remove(run._r)
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(0)
    paragraph.paragraph_format.line_spacing = 1.0
    _format_run(paragraph.add_run(text), size=8.5, color=_BODY, bold=bold)


def _add_technical_skills_table(document: Document):
    table = document.add_table(rows=len(_TECHNICAL_SKILL_ROWS), cols=2)
    table.style = "Normal Table"
    table.autofit = True
    _set_table_width_and_borders(table)
    for row, (label, value) in zip(table.rows, _TECHNICAL_SKILL_ROWS):
        _set_cell_width(row.cells[0], 1900)
        _set_cell_width(row.cells[1], 7460)
        _set_cell_text(row.cells[0], label, bold=True)
        _set_cell_text(row.cells[1], value)
    return table


def _add_text_paragraph(
    document: Document,
    text: str,
    *,
    size: float = 9.4,
    color: RGBColor = _BODY,
    bold: bool = False,
    italic: bool = False,
    align: WD_ALIGN_PARAGRAPH | None = None,
    before: float | None = None,
    after: float | None = 2.2,
):
    paragraph = document.add_paragraph()
    if align is not None:
        paragraph.alignment = align
    if before is not None:
        paragraph.paragraph_format.space_before = Pt(before)
    if after is not None:
        paragraph.paragraph_format.space_after = Pt(after)
    paragraph.paragraph_format.line_spacing = 1.0
    _format_run(paragraph.add_run(text), size=size, color=color, bold=bold, italic=italic)
    return paragraph


def _add_role_line(document: Document, text: str):
    parts = [part.strip() for part in re.split(r"\s+\|\s+", text) if part.strip()]
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.space_before = Pt(7.5)
    paragraph.paragraph_format.space_after = Pt(0.6)
    paragraph.paragraph_format.line_spacing = 1.0
    if not parts:
        return paragraph
    _format_run(paragraph.add_run(parts[0]), size=11, color=_BODY, bold=True)
    if len(parts) > 1:
        _format_run(paragraph.add_run("   |   "), color=_GRAY)
        _format_run(paragraph.add_run(parts[1]), color=_BLUE, bold=True)
    for part in parts[2:]:
        _format_run(paragraph.add_run(f"   |   {part}"), color=_GRAY)
    return paragraph


def _add_labeled_italic(document: Document, text: str, label: str, *, size: float = 9.0, before: float = 0.0, after: float = 1.2):
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.space_before = Pt(before)
    paragraph.paragraph_format.space_after = Pt(after)
    paragraph.paragraph_format.line_spacing = 1.0
    if text.lower().startswith(label.lower()):
        value = text[len(label):].strip()
        _format_run(paragraph.add_run(label), size=size, color=_GRAY, bold=True, italic=True)
        if value:
            _format_run(paragraph.add_run(f" {value}"), size=size, color=_GRAY, italic=True)
    else:
        _format_run(paragraph.add_run(text), size=size, color=_GRAY, italic=True)
    return paragraph


def _looks_like_role_line(line: str) -> bool:
    if "|" not in line:
        return False
    lowered = line.lower()
    return any(word in lowered for word in ("developer", "engineer", "architect", "lead", "manager", "analyst", "consultant"))


def _looks_like_date_line(line: str) -> bool:
    return bool(re.search(r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b.*\b(?:19|20)\d{2}|present|till date", line, re.I))


def _normalized_heading(line: str) -> str:
    return line.strip().rstrip(":").strip().lower()


def _looks_like_role_title(line: str) -> bool:
    if "|" in line:
        return False
    lowered = line.lower().strip()
    if not lowered or len(lowered.split()) > 10:
        return False
    return any(word in lowered for word in ("developer", "engineer", "architect", "lead", "manager", "analyst", "consultant"))


def _split_company_location_date(line: str) -> tuple[str, str, str] | None:
    parts = [part.strip() for part in re.split(r"\s+\|\s+", line.strip()) if part.strip()]
    if len(parts) < 3:
        return None
    date_parts: list[str] = []
    while parts and (_looks_like_date_line(parts[-1]) or date_parts):
        date_parts.insert(0, parts.pop())
        if date_parts and len(" | ".join(date_parts).split()) >= 2:
            break
    if len(parts) < 2 or not date_parts:
        return None
    company = parts[0]
    location = " | ".join(parts[1:])
    date = " | ".join(date_parts)
    return company, location, date


def _prepare_resume_lines(resume_text: str) -> list[str]:
    """Normalize AI output into the canonical resume-template line structure."""
    raw_lines = [line.strip() for line in resume_only_text(resume_text).splitlines() if line.strip()]
    lines: list[str] = []
    i = 0
    in_experience = False
    in_responsibilities = False

    while i < len(raw_lines):
        line = raw_lines[i]
        heading = _normalized_heading(line)

        if heading == "technical sk":
            i += 1
            continue

        if heading == "technical skills":
            lines.append("TECHNICAL SKILLS")
            i += 1
            while i < len(raw_lines) and _normalized_heading(raw_lines[i]) not in {"professional experience", "experience", "work experience"}:
                i += 1
            continue

        if heading in {"professional experience", "experience", "work experience"}:
            lines.append("PROFESSIONAL EXPERIENCE")
            in_experience = True
            in_responsibilities = False
            i += 1
            continue

        if in_experience and line.lower().startswith("project overview:"):
            i += 1
            continue

        if in_experience and "project overview:" in line.lower():
            line = re.split(r"project overview:", line, maxsplit=1, flags=re.I)[0].strip()
            if not line:
                i += 1
                continue

        if in_experience and heading == "responsibilities":
            in_responsibilities = True
            i += 1
            continue

        if in_experience and line.lower().startswith("environment:"):
            lines.append(line)
            in_responsibilities = False
            i += 1
            continue

        if in_experience and _looks_like_role_title(line) and i + 1 < len(raw_lines):
            split = _split_company_location_date(raw_lines[i + 1])
            if split:
                company, location, date = split
                lines.append(f"{line} | {company} | {location}")
                lines.append(date)
                in_responsibilities = False
                i += 2
                continue

        if in_experience and in_responsibilities and not _is_bullet(line):
            lines.append(f"- {line}")
            i += 1
            continue

        lines.append(line)
        i += 1

    return lines


def build_resume_docx(resume_text: str, *, candidate_name: str | None = None) -> bytes:
    """Convert plain-text resume into the canonical Microsoft resume format."""
    document = Document()

    style = document.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(9.4)
    style.font.color.rgb = _BODY
    style.paragraph_format.space_after = Pt(2.2)
    style.paragraph_format.line_spacing = 1.0

    for section in document.sections:
        section.top_margin = Inches(0.472)
        section.bottom_margin = Inches(0.472)
        section.left_margin = Inches(0.625)
        section.right_margin = Inches(0.625)

    lines = _prepare_resume_lines(resume_text)
    first_content = next((l.strip() for l in lines if l.strip()), "")
    name_line = (candidate_name or first_content).strip()

    consumed_name = False
    header_zone = True  # contact lines before the first section heading
    in_experience = False
    previous_was_heading = False

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            continue

        if not consumed_name and line.strip() == name_line.strip():
            _add_text_paragraph(
                document,
                line.strip().upper(),
                size=14,
                color=_BLUE,
                bold=True,
                align=WD_ALIGN_PARAGRAPH.CENTER,
                after=2.2,
            )
            consumed_name = True
            continue

        if _is_section_heading(line):
            header_zone = False
            heading = line.strip().rstrip(":").strip().upper()
            in_experience = heading == "PROFESSIONAL EXPERIENCE"
            _add_text_paragraph(document, heading, size=11.5, color=_BLUE, bold=True, before=7.5, after=2.4)
            if heading == "TECHNICAL SKILLS":
                _add_technical_skills_table(document)
            previous_was_heading = True
            continue

        if header_zone:
            is_contact = "@" in line or "linkedin" in line.lower() or re.search(r"\d{3}[-.) ]+\d{3}", line)
            _add_text_paragraph(
                document,
                line.strip(),
                size=9.5 if is_contact else 11,
                color=_HEADER_GRAY,
                align=WD_ALIGN_PARAGRAPH.CENTER,
                after=6.0 if is_contact else 2.2,
            )
            previous_was_heading = False
            continue

        if in_experience and _looks_like_role_line(line):
            _add_role_line(document, line.strip())
            previous_was_heading = False
            continue

        if in_experience and _looks_like_date_line(line):
            _add_text_paragraph(document, line.strip(), size=9.5, color=_GRAY, italic=True, after=1.6)
            previous_was_heading = False
            continue

        if in_experience and line.strip().lower().startswith("project:"):
            _add_labeled_italic(document, line.strip(), "Project:", size=9.0, after=1.2)
            previous_was_heading = False
            continue

        if in_experience and line.strip().lower().startswith("environment:"):
            _add_labeled_italic(document, line.strip(), "Environment:", size=8.0, before=1.4, after=1.75)
            previous_was_heading = False
            continue

        if _is_bullet(line):
            text = re.sub(r"^\s*[-•*o]\s+", "", line)
            p = document.add_paragraph(text, style="List Bullet")
            p.paragraph_format.space_before = Pt(1.1)
            p.paragraph_format.space_after = Pt(1.1)
            p.paragraph_format.line_spacing = 1.0
            for run in p.runs:
                _format_run(run)
            previous_was_heading = False
            continue

        if "   ·   " in line or " · " in line:
            _add_text_paragraph(document, line.strip(), before=2.0 if previous_was_heading else 0.0, after=0.7)
        else:
            _add_text_paragraph(document, line.strip(), before=2.5 if previous_was_heading else 0.0, after=2.5)
        previous_was_heading = False

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()
