from pathlib import Path


def test_openrouter_claude_45_model_ids_use_decimal_version():
    catalog = (Path(__file__).parents[1] / "frontend/lib/api.ts").read_text(encoding="utf-8")

    assert "anthropic/claude-sonnet-4.5" in catalog
    assert "anthropic/claude-opus-4.5" in catalog
    assert "anthropic/claude-sonnet-4-5" not in catalog
    assert "anthropic/claude-opus-4-5" not in catalog
