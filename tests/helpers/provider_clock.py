"""Clock for synthetic provider events fixed at 24 October 2026."""
from datetime import datetime, timezone


class ProviderFixtureDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        value=cls(2026,10,20,12,tzinfo=timezone.utc)
        return value.astimezone(tz) if tz else value.replace(tzinfo=None)
