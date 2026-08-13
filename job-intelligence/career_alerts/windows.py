"""Central-time delivery windows for career alert messages."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

CENTRAL = ZoneInfo("America/Chicago")
_DAYTIME_STARTS = {10: 7, 13: 10, 16: 13, 19: 16}


@dataclass(frozen=True)
class DeliveryWindow:
    start: datetime
    end: datetime
    label: str
    kind: Literal["regular", "overnight", "weekend"]


def delivery_window(now: datetime) -> DeliveryWindow:
    """Return the scheduled window ending at an aware delivery timestamp."""
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("delivery time must be timezone-aware")
    end = now.astimezone(CENTRAL)
    if any((end.minute, end.second, end.microsecond)) or end.hour not in {
        7,
        *_DAYTIME_STARTS,
    }:
        raise ValueError("delivery time must be a configured delivery slot")

    if end.hour == 7:
        if end.weekday() == 0:
            start = _at(end.date() - timedelta(days=3), 19)
            label = "Weekend Jobs Fri 7 PM-Mon 7 AM"
            return DeliveryWindow(start, end, label, "weekend")
        start_date = end.date() - timedelta(days=1)
        start = _at(start_date, 19)
        label = (
            f"Overnight Jobs {start:%a} 7 PM-{end:%a} 7 AM"
        )
        return DeliveryWindow(start, end, label, "overnight")

    start_hour = _DAYTIME_STARTS[end.hour]
    start = _at(end.date(), start_hour)
    label = f"3-Hour Jobs {_hour_label(start)}-{_hour_label(end)}"
    return DeliveryWindow(start, end, label, "regular")


def _at(day: date, hour: int) -> datetime:
    # Construct each wall-clock endpoint independently so ZoneInfo applies the
    # correct offset on both sides of a DST transition.
    return datetime.combine(day, time(hour), tzinfo=CENTRAL)


def _hour_label(value: datetime) -> str:
    hour = value.hour % 12 or 12
    return f"{hour} {'AM' if value.hour < 12 else 'PM'}"
