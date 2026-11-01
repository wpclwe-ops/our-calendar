"""Personal daily digests, using the existing durable Telegram outbox."""
from datetime import date, datetime, time, timedelta
import json
import logging

from .recurrence import UTC, stamp, zone

log = logging.getLogger('our_calendar.worker')


def due_at(day, value, timezone):
    """First occurrence of a repeated hour; first valid minute after a DST gap."""
    wall = datetime.combine(day, time.fromisoformat(value))
    tz = zone(timezone)
    while wall.date() == day:
        local = wall.replace(tzinfo=tz, fold=0)
        instant = local.astimezone(UTC)
        if instant.astimezone(tz).replace(tzinfo=None) == wall:
            return instant
        wall += timedelta(minutes=1)
    return None


def telegram_length(text):
    # Astral characters, including emoji, take two Telegram UTF-16 code units.
    return len(text.encode('utf-16-le')) // 2


def message_chunks(day, person, people, events, incomplete=False):
    ru = person['language'] == 'ru'
    header = ('Сводка дня · ' if ru else 'Daily summary · ') + day.strftime('%d.%m.%Y')
    header += '\n' + person['timezone']
    lines = []
    for event in events:
        title = event.get('translations', {}).get(person['language'], {}).get('title') or event['title']
        title = ' '.join(title.split())
        owner = event['owner']
        who = ('Вместе' if ru else 'Together') if owner == 'both' else (
            ('Ты' if ru else 'You') if owner == person['id'] else
            people.get(owner, {}).get('name') or ('Партнёр' if ru else 'Partner'))
        who = ' '.join(who.split())
        if event['all_day']:
            when = 'Весь день' if ru else 'All day'
        else:
            start = datetime.fromisoformat(event['start_utc']).astimezone(zone(person['timezone']))
            end = datetime.fromisoformat(event['end_utc']).astimezone(zone(person['timezone']))
            # Clip continuations to today's bounds, without presenting tomorrow as today.
            a = '00:00' if start.date() < day else start.strftime('%H:%M')
            b = '24:00' if end.date() > day else end.strftime('%H:%M')
            when = a + '–' + b
        status = {'done': ' · Выполнено' if ru else ' · Done',
                  'cancelled': ' · Отменено' if ru else ' · Cancelled'}.get(event['status'], '')
        lines.append(f'• {when} · {title} — {who}{status}')
    if incomplete:
        lines.append('Некоторые события не удалось прочитать. Проверьте календарь.' if ru else
                     'Some events could not be read. Please check the calendar.')
    elif not lines:
        lines.append('На сегодня событий нет.' if ru else 'No events today.')
    # Reserve space for the date, timezone and part number. Never discard events.
    parts, current = [], []
    for line in lines:
        if current and telegram_length('\n'.join(current + [line])) > 3400:
            parts.append('\n'.join(current))
            current = []
        current.append(line)
    if current:
        parts.append('\n'.join(current))
    return [header + (f' · {i + 1}/{len(parts)}' if len(parts) > 1 else '') + '\n\n' + body
            for i, body in enumerate(parts)]


class DailySummaries:
    def __init__(self, service):
        self.service = service

    def schedule(self, now):
        with self.service.db.transaction() as c:
            members = c.execute("SELECT m.* FROM members m JOIN calendars ca ON ca.id=m.calendar_id "
                                "WHERE m.active=1 AND ca.state='active'").fetchall()
            for member in members:
                if not self.service.is_allowed_user(member['user_id']):
                    continue
                person = self.service.user(c, member['user_id'])
                if not person['daily_summary_enabled'] or not person.get('notifications_enabled', True):
                    continue
                today = now.astimezone(zone(person['timezone'])).date()
                since = datetime.fromisoformat(person.get('daily_summary_since', stamp(now)))
                for day in (today, today + timedelta(days=1)):
                    due = due_at(day, person['daily_summary_time'], person['timezone'])
                    if due is None or due < since:
                        continue
                    payload = {'action': 'daily_summary', 'day': day.isoformat(),
                               'timezone': person['timezone'], 'time': person['daily_summary_time'],
                               'generation': person.get('daily_summary_generation', '')}
                    key = ':'.join(['daily_summary', member['calendar_id'], person['id'], day.isoformat()])
                    # A new setting may replace an unsent digest. A sent digest stays sent,
                    # including after a restart, time edit, or the second DST fold.
                    c.execute("INSERT INTO outbox(id,calendar_id,user_id,kind,payload,due,created_at) "
                              "VALUES(?,?,?,'daily_summary',?,?,?) ON CONFLICT(id) DO UPDATE SET "
                              "payload=excluded.payload,due=excluded.due,status='pending',attempts=0,"
                              "error=NULL,lease_until=NULL WHERE outbox.status IN ('pending','cancelled','failed') "
                              "AND json_extract(outbox.payload,'$.generation')<>json_extract(excluded.payload,'$.generation') "
                              "AND COALESCE(json_extract(outbox.payload,'$.next_part'),0)=0",
                              (key, member['calendar_id'], person['id'], json.dumps(payload), stamp(due), stamp(now)))

    @staticmethod
    def current(job, person, now):
        payload = json.loads(job['payload'])
        return (person['daily_summary_enabled'] and person.get('notifications_enabled', True)
                and payload['generation'] == person.get('daily_summary_generation', '')
                and payload['timezone'] == person['timezone']
                and payload['time'] == person['daily_summary_time']
                and payload['day'] == now.astimezone(zone(person['timezone'])).date().isoformat())

    def prepare(self, c, job, person):
        """Snapshot effective occurrences at delivery, independent of UI filters."""
        payload = json.loads(job['payload'])
        if 'chunks' in payload:
            return payload
        day = date.fromisoformat(payload['day'])
        tz = zone(person['timezone'])
        first = datetime.combine(day, time(), tz).astimezone(UTC)
        last = datetime.combine(day + timedelta(days=1), time(), tz).astimezone(UTC)
        people = {row['user_id']: self.service.user(c, row['user_id']) for row in
                  c.execute('SELECT user_id FROM members WHERE calendar_id=?', (job['calendar_id'],))}
        events, incomplete = [], False
        for row in c.execute('SELECT * FROM events WHERE calendar_id=? AND deleted_at IS NULL',
                             (job['calendar_id'],)).fetchall():
            data = self.service.event_data(row)
            overrides = {v['occurrence']: json.loads(v['data']) for v in
                         c.execute('SELECT * FROM overrides WHERE event_id=?', (row['id'],))}
            try:
                for event in self.service.expanded(data, overrides, first, last):
                    if event.get('deleted'):
                        continue
                    if event['all_day']:
                        show = event['start'] < (day + timedelta(days=1)).isoformat() and event['end'] > day.isoformat()
                    else:
                        show = (datetime.fromisoformat(event['start_utc']) < last
                                and datetime.fromisoformat(event['end_utc']) > first)
                    if show:
                        events.append(event)
            except Exception:
                # One invalid legacy series must not stop other events or recipients.
                incomplete = True
                log.warning('Daily summary could not expand an event')
        events.sort(key=lambda e: (not e['all_day'], e.get('start_utc', e['start']), e['id'], e['occurrence']))
        payload.update(chunks=message_chunks(day, person, people, events, incomplete), next_part=0)
        return payload
