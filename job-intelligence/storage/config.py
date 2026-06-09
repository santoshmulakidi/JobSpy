from __future__ import annotations

from functools import lru_cache

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
    usajobs_api_key: str | None = None
    usajobs_user_agent: str | None = None
    cors_origins: str = "http://127.0.0.1:3000,http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="JOB_INTELLIGENCE_",
        extra="ignore",
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
