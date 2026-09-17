"""Pull event dates out of Korean screenshot text.

This is what makes resurfacing useful instead of random. A screenshot saying
"10월 3일 오후 7시 2인 예약 완료" is worth showing on October 2nd and worthless
in December. Without a date, the best the app can do is "here's something old",
which is noise.

Deliberately regex, not the LLM: dates are the one thing in a screenshot with a
rigid surface form, the patterns are few, and a wrong date is worse than no date
(it would fire a reminder on the wrong day). The LLM handles meaning; this
handles the calendar.
"""
import datetime
import re
from typing import Optional

# "10월 3일", "10월3일", "12월 25일"
_MONTH_DAY = re.compile(r"(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일")
# "2026년 10월 3일"
_YEAR_MONTH_DAY = re.compile(r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")
# "11월까지" -- an end-of-availability marker; treat as the last day of that month
_MONTH_UNTIL = re.compile(r"(?<!\d)(\d{1,2})\s*월\s*까지")
# "2026-10-03", "2026.10.03", "2026/10/03"
_ISO_LIKE = re.compile(r"(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)")


def _safe_date(year: int, month: int, day: int) -> Optional[datetime.date]:
    try:
        return datetime.date(year, month, day)
    except ValueError:
        return None


def _last_day_of_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (datetime.date(year, month + 1, 1) - datetime.timedelta(days=1)).day


def extract_event_date(text: str, today: Optional[datetime.date] = None) -> Optional[datetime.date]:
    """Best-effort single event date. Returns None when the text has no date.

    Bare "10월 3일" has no year, so it resolves to the next occurrence: a date
    that already passed this year rolls to next year, because a screenshot of a
    reservation is about an upcoming one.
    """
    if not text:
        return None
    today = today or datetime.date.today()

    match = _YEAR_MONTH_DAY.search(text)
    if match:
        return _safe_date(int(match.group(1)), int(match.group(2)), int(match.group(3)))

    match = _ISO_LIKE.search(text)
    if match:
        return _safe_date(int(match.group(1)), int(match.group(2)), int(match.group(3)))

    match = _MONTH_DAY.search(text)
    if match:
        month, day = int(match.group(1)), int(match.group(2))
        candidate = _safe_date(today.year, month, day)
        if candidate is None:
            return None
        # More than a month in the past reads as "next year", not "long ago" --
        # a small backward slack keeps a reservation from yesterday findable.
        if (today - candidate).days > 31:
            return _safe_date(today.year + 1, month, day)
        return candidate

    match = _MONTH_UNTIL.search(text)
    if match:
        month = int(match.group(1))
        year = today.year if month >= today.month else today.year + 1
        return _safe_date(year, month, _last_day_of_month(year, month))

    return None


def days_until(event_date: datetime.date, today: Optional[datetime.date] = None) -> int:
    return (event_date - (today or datetime.date.today())).days
