import base64
import hashlib
import hmac
import json
import secrets
import time
from urllib.parse import parse_qsl

# These are the only Telegram accounts allowed to use the production bot and Mini App.
MY_ID = 100000001
PARTNER_ID = 100000002
ALLOWED_USERS = {MY_ID, PARTNER_ID}
_ALLOWED_USER_IDS = frozenset(str(user_id) for user_id in ALLOWED_USERS)

def is_allowed_user(user_id):
    return str(user_id) in _ALLOWED_USER_IDS

class Problem(Exception):
    def __init__(self, status, code, detail=None):
        self.status, self.code, self.detail = status, code, detail
        super().__init__(code)

def require(test, code, status=400, detail=None):
    if not test:
        raise Problem(status, code, detail)

def telegram_user(raw, token, max_age=3600, now=None):
    now = time.time() if now is None else now
    pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True)
    require(len(pairs) == len(dict(pairs)), 'invalid_init_data', 401)
    fields = dict(pairs)
    signature = fields.pop('hash', '')
    check = '\n'.join(f'{k}={v}' for k, v in sorted(fields.items()))
    secret = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    require(hmac.compare_digest(signature, expected), 'invalid_init_data', 401)
    try:
        stamp = int(fields['auth_date'])
        user = json.loads(fields['user'])
        uid = user['id']
        require(isinstance(uid, int) and not isinstance(uid, bool) and uid > 0, 'invalid_user', 401)
        require(-30 <= now - stamp <= max_age, 'expired_init_data', 401)
    except (KeyError, ValueError, TypeError):
        raise Problem(401, 'invalid_init_data')
    return user

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def session_token(user_id, secret, ttl=3600):
    body = base64.urlsafe_b64encode(json.dumps({'uid': str(user_id), 'exp': int(time.time()) + ttl,
                                                   'nonce': secrets.token_hex(8)}, separators=(',', ':')).encode()).decode().rstrip('=')
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return body + '.' + sig

def session_user(value, secret):
    try:
        body, sig = value.split('.')
        require(hmac.compare_digest(sig, hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()), 'invalid_session', 401)
        data = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
        require(data['exp'] > time.time(), 'expired_session', 401)
        return str(data['uid'])
    except (ValueError, KeyError, TypeError):
        raise Problem(401, 'invalid_session')
