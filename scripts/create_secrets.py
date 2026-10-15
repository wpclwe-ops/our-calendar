"""Generate new random application secrets locally. These are not the Telegram token."""
import secrets
print('SESSION_SECRET='+secrets.token_urlsafe(48))
print('WEBHOOK_SECRET='+secrets.token_urlsafe(48))
