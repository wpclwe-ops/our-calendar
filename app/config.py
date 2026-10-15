from dataclasses import dataclass
from pathlib import Path
import os

@dataclass(frozen=True)
class Config:
    database: str = 'data/calendar.sqlite3'
    bot_token: str = ''
    bot_username: str = ''
    public_url: str = ''
    webhook_secret: str = ''
    session_secret: str = ''
    archive_key_file: str = 'data/archive-key.pem'
    archive_public_keys: str = 'data/archive-public-keys.json'
    demo: bool = False
    translation_url: str = ''
    translation_api_key: str = ''
    auth_max_age: int = 3600
    session_ttl: int = 3600

    @classmethod
    def env(cls):
        c = cls(database=os.getenv('DATABASE_PATH', 'data/calendar.sqlite3'),
                bot_token=os.getenv('BOT_TOKEN', ''), bot_username=os.getenv('BOT_USERNAME', '').lstrip('@'),
                public_url=os.getenv('PUBLIC_URL', '').rstrip('/'),
                webhook_secret=os.getenv('WEBHOOK_SECRET', ''), session_secret=os.getenv('SESSION_SECRET', ''),
                archive_key_file=os.getenv('ARCHIVE_KEY_FILE', 'data/archive-key.pem'),
                archive_public_keys=os.getenv('ARCHIVE_PUBLIC_KEYS', 'data/archive-public-keys.json'),
                translation_url=os.getenv('TRANSLATION_URL','').rstrip('/'),translation_api_key=os.getenv('TRANSLATION_API_KEY',''),
                demo=os.getenv('DEMO_MODE', 'false').lower() == 'true')
        if c.translation_url and not c.translation_url.startswith('https://'):
            raise ValueError('TRANSLATION_URL must use HTTPS')
        if not c.demo:
            if not c.bot_token or len(c.session_secret) < 32 or len(c.webhook_secret) < 32:
                raise ValueError('Set BOT_TOKEN, SESSION_SECRET and WEBHOOK_SECRET (secrets: at least 32 characters)')
            if not c.public_url.startswith('https://') or not c.bot_username:
                raise ValueError('Set HTTPS PUBLIC_URL and BOT_USERNAME')
        Path(c.database).parent.mkdir(parents=True, exist_ok=True)
        return c
