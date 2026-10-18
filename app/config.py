from dataclasses import dataclass
from pathlib import Path
import os
from urllib.parse import urlsplit

def valid_translation_url(value):
    if not value:return True
    url=urlsplit(value)
    if url.username or url.password or url.query or url.fragment:return False
    # Railway's private service mesh is encrypted; HTTP never leaves the project.
    return bool(url.hostname) and (url.scheme=='https' or (
        url.scheme=='http' and url.hostname.endswith('.railway.internal')))

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
    backup_endpoint: str = ''
    backup_bucket: str = ''
    backup_region: str = 'auto'
    backup_access_key: str = ''
    backup_secret_key: str = ''
    backup_encryption_key: str = ''
    auto_setup_bot: bool = False
    auth_max_age: int = 3600
    session_ttl: int = 3600
    google_client_id: str = ''
    google_client_secret: str = ''
    google_credential_key: str = ''
    icloud_credential_key: str = ''
    openai_api_key: str = ''
    openai_model: str = 'gpt-6-luna'
    openai_max_output_tokens: int = 16384
    smart_monthly_budget: float = 5.0
    smart_auto_categories: bool = False

    @classmethod
    def env(cls):
        c = cls(database=os.getenv('DATABASE_PATH', 'data/calendar.sqlite3'),
                bot_token=os.getenv('BOT_TOKEN', ''), bot_username=os.getenv('BOT_USERNAME', '').lstrip('@'),
                public_url=os.getenv('PUBLIC_URL', '').rstrip('/'),
                webhook_secret=os.getenv('WEBHOOK_SECRET', ''), session_secret=os.getenv('SESSION_SECRET', ''),
                archive_key_file=os.getenv('ARCHIVE_KEY_FILE', 'data/archive-key.pem'),
                archive_public_keys=os.getenv('ARCHIVE_PUBLIC_KEYS', 'data/archive-public-keys.json'),
                auto_setup_bot=os.getenv('AUTO_SETUP_BOT','true').lower()=='true',
                translation_url=os.getenv('TRANSLATION_URL','').rstrip('/'),translation_api_key=os.getenv('TRANSLATION_API_KEY',''),
                demo=os.getenv('DEMO_MODE', 'false').lower() == 'true',
                google_client_id=os.getenv('GOOGLE_CLIENT_ID',''),
                google_client_secret=os.getenv('GOOGLE_CLIENT_SECRET',''),
                google_credential_key=os.getenv('GOOGLE_CREDENTIAL_KEY',''),
                icloud_credential_key=os.getenv('ICLOUD_CREDENTIAL_KEY',''),
                openai_api_key=os.getenv('OPENAI_API_KEY',''),
                openai_model=os.getenv('OPENAI_MODEL','gpt-6-luna'),
                openai_max_output_tokens=int(os.getenv('OPENAI_MAX_OUTPUT_TOKENS','16384')),
                smart_monthly_budget=float(os.getenv('SMART_MONTHLY_BUDGET_USD','5')),
                smart_auto_categories=os.getenv('SMART_AUTO_CATEGORIES_ENABLED','false').lower()=='true',
                backup_endpoint=os.getenv('OPERATOR_BACKUP_ENDPOINT',''),backup_bucket=os.getenv('OPERATOR_BACKUP_BUCKET',''),
                backup_region=os.getenv('OPERATOR_BACKUP_REGION','auto'),backup_access_key=os.getenv('OPERATOR_BACKUP_ACCESS_KEY',''),
                backup_secret_key=os.getenv('OPERATOR_BACKUP_SECRET_KEY',''),backup_encryption_key=os.getenv('OPERATOR_BACKUP_KEY',''))
        import math
        if c.openai_model not in ('gpt-6-luna','gpt-5.4-mini') or not 1024 <= c.openai_max_output_tokens <= 32768:
            raise ValueError('Unsupported OPENAI_MODEL or output token limit')
        if not math.isfinite(c.smart_monthly_budget) or not 0 <= c.smart_monthly_budget <= 1000:
            raise ValueError('Invalid SMART_MONTHLY_BUDGET_USD')
        if not valid_translation_url(c.translation_url):
            raise ValueError('TRANSLATION_URL must use HTTPS or Railway private networking')
        for key in (c.google_credential_key,c.icloud_credential_key):
            if key:
                from cryptography.fernet import Fernet
                Fernet(key.encode())
        if any((c.backup_endpoint,c.backup_bucket,c.backup_access_key,c.backup_secret_key,c.backup_encryption_key)):
            if not all((c.backup_endpoint,c.backup_bucket,c.backup_access_key,c.backup_secret_key,c.backup_encryption_key)):
                raise ValueError('Complete all OPERATOR_BACKUP variables')
            target=urlsplit(c.backup_endpoint)
            if target.scheme!='https' or not target.hostname or target.username or target.password or target.query or target.fragment:
                raise ValueError('OPERATOR_BACKUP_ENDPOINT must be an HTTPS endpoint')
            from cryptography.fernet import Fernet
            Fernet(c.backup_encryption_key.encode())
        if not c.demo:
            if not c.bot_token or len(c.session_secret) < 32 or len(c.webhook_secret) < 32:
                raise ValueError('Set BOT_TOKEN, SESSION_SECRET and WEBHOOK_SECRET (secrets: at least 32 characters)')
            if not c.public_url.startswith('https://') or not c.bot_username:
                raise ValueError('Set HTTPS PUBLIC_URL and BOT_USERNAME')
        Path(c.database).parent.mkdir(parents=True, exist_ok=True)
        return c
