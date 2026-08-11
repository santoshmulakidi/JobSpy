from ai.resume_rebuilder import _provider_order
from storage.config import Settings


def test_general_ai_uses_omniroute_but_never_paid_openrouter_by_default():
    settings = Settings(
        _env_file=None,
        openrouter_api_key="paid-openrouter",
        gemini_api_key="gemini",
        ai_provider_order="omniroute,gemini,nvidia",
    )
    providers = _provider_order(settings)
    assert providers[0]["name"] == "omniroute"
    assert providers[0]["model"] == settings.omniroute_model
    assert providers[0]["api_key"] == ""
    assert all(provider["name"] != "openrouter" for provider in providers)
