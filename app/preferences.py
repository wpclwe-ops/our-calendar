"""Validation shared by personal settings, pair profiles and signed restores."""
import base64
import binascii
import struct
from datetime import date
from .security import require

PAIR_FIELDS = {'name', 'avatar', 'relationship_started'}


def notification_offsets(values):
    require(isinstance(values, list) and len(values) <= 2 and
            all(type(v) is int and 0 <= v <= 525600 for v in values) and
            len(set(values)) == len(values), 'invalid_default_notifications')
    return sorted(values, reverse=True)


def event_notifications(values):
    require(isinstance(values, list) and len(values) <= 4 and
            all(type(v) is int and 0 <= v <= 525600 for v in values) and
            len(set(values)) == len(values) and len([v for v in values if v > 0]) <= 3,
            'invalid_reminders')
    return sorted((v for v in values if v > 0), reverse=True), 0 in values


def validate_pair_profile(value):
    require(isinstance(value, dict) and set(value) <= PAIR_FIELDS, 'invalid_pair_profile')
    if 'name' in value:
        require(isinstance(value['name'], str) and len(value['name']) <= 100, 'invalid_text')
    if 'relationship_started' in value:
        v = value['relationship_started']
        require(isinstance(v, str), 'invalid_relationship_date')
        if v:
            try:
                require(date.fromisoformat(v).isoformat() == v, 'invalid_relationship_date')
            except ValueError:
                require(False, 'invalid_relationship_date')
    if 'avatar' in value:
        avatar = value['avatar']
        require(isinstance(avatar, str) and len(avatar) <= 350000, 'invalid_avatar')
        if avatar:
            require(avatar.startswith('data:image/png;base64,'), 'invalid_avatar')
            try:
                data = base64.b64decode(avatar.split(',', 1)[1], validate=True)
            except (ValueError, binascii.Error):
                require(False, 'invalid_avatar')
            require(45 <= len(data) <= 262144 and data[:8] == b'\x89PNG\r\n\x1a\n' and
                    data[8:16] == b'\x00\x00\x00\rIHDR' and
                    data[-12:] == b'\x00\x00\x00\x00IEND\xaeB`\x82', 'invalid_avatar')
            width, height = struct.unpack('>II', data[16:24])
            require(0 < width <= 512 and 0 < height <= 512, 'invalid_avatar')
    return value
