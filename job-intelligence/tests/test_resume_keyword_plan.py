from ai.resume_keyword_plan import (
    build_keyword_plan,
    normalized_hash,
    replace_two_recent_titles,
)


THREE_ROLE_RESUME = """Santosh Mulakidi
Senior .NET Developer

PROFESSIONAL EXPERIENCE
Senior .NET Developer | Acme Corp | Dallas, TX
2024 - Present
- Built Python APIs with Azure.

Software Engineer | Beta LLC | Austin, TX
2021 - 2024
- Developed REST services.

Junior Developer | OldCo | Houston, TX
2018 - 2021
- Maintained internal applications.

EDUCATION
Master of Science
"""


def test_keyword_plan_requires_only_source_supported_jd_terms():
    plan = build_keyword_plan(
        "Senior engineer using Python, PyTorch, Azure, and REST APIs.",
        "AI Engineer requires Python, PyTorch, Azure, LangChain, and Kubernetes.",
        target_title="AI Engineer",
    )
    assert plan.supported == ["Python", "PyTorch", "Azure"]
    assert plan.unsupported == ["LangChain", "Kubernetes"]


def test_replace_two_recent_titles_preserves_older_role_and_employers():
    transformed, originals = replace_two_recent_titles(THREE_ROLE_RESUME, "AI Engineer")
    assert originals == ["Senior .NET Developer", "Software Engineer"]
    assert transformed.count("AI Engineer |") == 2
    assert "Acme Corp" in transformed and "2024 - Present" in transformed
    assert "Junior Developer | OldCo" in transformed


def test_hash_is_stable_for_line_endings_and_outer_space():
    assert normalized_hash(" a\r\nb ") == normalized_hash("a\nb")
