from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from storage.config import Settings


logger = logging.getLogger(__name__)


@dataclass
class NotificationDispatcher:
    slack_webhook_url: str | None = None
    discord_webhook_url: str | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None

    @classmethod
    def from_settings(cls, settings: Settings) -> "NotificationDispatcher":
        return cls(
            slack_webhook_url=settings.slack_webhook_url,
            discord_webhook_url=settings.discord_webhook_url,
            telegram_bot_token=settings.telegram_bot_token,
            telegram_chat_id=settings.telegram_chat_id,
        )

    def send(self, message: str) -> None:
        if self.slack_webhook_url:
            self._post_json(self.slack_webhook_url, {"text": message})
        if self.discord_webhook_url:
            self._post_json(self.discord_webhook_url, {"content": message})
        if self.telegram_bot_token and self.telegram_chat_id:
            self._post_json(
                f"https://api.telegram.org/bot{self.telegram_bot_token}/sendMessage",
                {"chat_id": self.telegram_chat_id, "text": message},
            )

    @staticmethod
    def _post_json(url: str, payload: dict) -> None:
        try:
            with httpx.Client(timeout=10) as client:
                response = client.post(url, json=payload)
                response.raise_for_status()
        except httpx.HTTPError:
            logger.exception("notification delivery failed")
