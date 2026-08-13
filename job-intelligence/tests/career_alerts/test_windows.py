from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from career_alerts.windows import delivery_window

CENTRAL = ZoneInfo("America/Chicago")


def test_monday_7am_is_weekend_window():
    window = delivery_window(datetime(2026, 8, 17, 7, 0, tzinfo=CENTRAL))

    assert window.label == "Weekend Jobs Fri 7 PM-Mon 7 AM"
    assert window.start == datetime(2026, 8, 14, 19, 0, tzinfo=window.start.tzinfo)
    assert window.end == datetime(2026, 8, 17, 7, 0, tzinfo=CENTRAL)
    assert window.kind == "weekend"


def test_tuesday_7am_is_overnight_window():
    window = delivery_window(datetime(2026, 8, 18, 7, 0, tzinfo=CENTRAL))

    assert window.label == "Overnight Jobs Mon 7 PM-Tue 7 AM"
    assert window.start == datetime(2026, 8, 17, 19, 0, tzinfo=CENTRAL)
    assert window.end == datetime(2026, 8, 18, 7, 0, tzinfo=CENTRAL)
    assert window.kind == "overnight"


@pytest.mark.parametrize(
    ("hour", "start_hour", "label"),
    [
        (10, 7, "3-Hour Jobs 7 AM-10 AM"),
        (13, 10, "3-Hour Jobs 10 AM-1 PM"),
        (16, 13, "3-Hour Jobs 1 PM-4 PM"),
        (19, 16, "3-Hour Jobs 4 PM-7 PM"),
    ],
)
def test_each_daytime_delivery_slot(hour, start_hour, label):
    now = datetime(2026, 8, 12, hour, 0, tzinfo=CENTRAL)

    window = delivery_window(now)

    assert window.label == label
    assert window.start == datetime(2026, 8, 12, start_hour, 0, tzinfo=CENTRAL)
    assert window.end == now
    assert window.kind == "regular"


def test_windows_use_dst_aware_central_wall_time():
    spring = delivery_window(datetime(2026, 3, 9, 7, 0, tzinfo=CENTRAL))
    fall = delivery_window(datetime(2026, 11, 2, 7, 0, tzinfo=CENTRAL))

    assert spring.start.utcoffset() == timedelta(hours=-6)
    assert spring.end.utcoffset() == timedelta(hours=-5)
    assert fall.start.utcoffset() == timedelta(hours=-5)
    assert fall.end.utcoffset() == timedelta(hours=-6)


def test_naive_delivery_time_is_rejected():
    with pytest.raises(ValueError, match="timezone-aware"):
        delivery_window(datetime(2026, 8, 12, 10, 0))  # noqa: DTZ001


def test_time_outside_delivery_slots_is_rejected():
    with pytest.raises(ValueError, match="delivery slot"):
        delivery_window(datetime(2026, 8, 12, 11, 0, tzinfo=CENTRAL))


@pytest.mark.parametrize("weekday", [15, 16])
def test_weekend_invocation_is_rejected(weekday):
    with pytest.raises(ValueError, match="weekend"):
        delivery_window(datetime(2026, 8, weekday, 7, 0, tzinfo=CENTRAL))
