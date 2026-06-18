from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./job_intelligence.db"
    log_level: str = "INFO"
    default_sites: str = "linkedin,indeed,google,career_page,jobright_h1b,dice"
    scheduler_hours: int = 1
    slack_webhook_url: str | None = None
    discord_webhook_url: str | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    adzuna_app_id: str | None = None
    adzuna_app_key: str | None = None
    cors_origins: str = "http://127.0.0.1:3000,http://localhost:3000"
    ai_provider_order: str = "groq,gemini,openrouter,nvidia"
    openrouter_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("JOB_INTELLIGENCE_OPENROUTER_API_KEY", "OPENROUTER_API_KEY"),
    )
    openrouter_model: str = "openrouter/auto"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_site_url: str = "http://127.0.0.1:3000"
    openrouter_app_name: str = "Job Intelligence Platform"
    nvidia_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("JOB_INTELLIGENCE_NVIDIA_API_KEY", "NVIDIA_API_KEY"),
    )
    nvidia_model: str = "meta/llama-3.1-8b-instruct"
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    groq_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("JOB_INTELLIGENCE_GROQ_API_KEY", "GROQ_API_KEY"),
    )
    groq_model: str = "llama-3.3-70b-versatile"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    gemini_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("JOB_INTELLIGENCE_GEMINI_API_KEY", "GEMINI_API_KEY"),
    )
    gemini_api_key_2: str | None = Field(
        default=None,
        validation_alias=AliasChoices("JOB_INTELLIGENCE_GEMINI_API_KEY_2", "GEMINI_API_KEY_2"),
    )
    gemini_api_key_3: str | None = Field(
        default=None,
        validation_alias=AliasChoices("JOB_INTELLIGENCE_GEMINI_API_KEY_3", "GEMINI_API_KEY_3"),
    )
    gemini_api_key_4: str | None = Field(
        default=None,
        validation_alias=AliasChoices("JOB_INTELLIGENCE_GEMINI_API_KEY_4", "GEMINI_API_KEY_4"),
    )
    gemini_api_key_5: str | None = Field(
        default=None,
        validation_alias=AliasChoices("JOB_INTELLIGENCE_GEMINI_API_KEY_5", "GEMINI_API_KEY_5"),
    )
    gemini_model: str = "gemini-2.5-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    resume_rebuild_max_tokens: int = 16384
    ai_request_timeout_seconds: int = 120

    @property
    def gemini_api_keys(self) -> list[str]:
        return [
            k for k in [
                self.gemini_api_key,
                self.gemini_api_key_2,
                self.gemini_api_key_3,
                self.gemini_api_key_4,
                self.gemini_api_key_5,
            ] if k
        ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="JOB_INTELLIGENCE_",
        extra="ignore",
        populate_by_name=True,
    )

    @property
    def default_site_list(self) -> list[str]:
        return [site.strip() for site in self.default_sites.split(",") if site.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
