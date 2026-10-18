from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from dateutil.rrule import rrulestr
from .security import require, Problem

UTC = timezone.utc
TIME_FIELDS = {'start', 'end', 'all_day', 'timezone', 'rrule'}

def utcnow():
    return datetime.now(UTC)

def stamp(value=None):
    return (value or utcnow()).isoformat(timespec='seconds')

def zone(name):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, TypeError):
        raise Problem(400, 'invalid_timezone')

def local_datetime(value, tz, fold=None):
    try:
        dt = datetime.fromisoformat(value)
        require(dt.tzinfo is None, 'use_local_datetime')
    except (TypeError, ValueError):
        raise Problem(400, 'invalid_datetime')
    a, b = dt.replace(tzinfo=zone(tz), fold=0), dt.replace(tzinfo=zone(tz), fold=1)
    require(a.astimezone(UTC).astimezone(a.tzinfo).replace(tzinfo=None) == dt, 'nonexistent_local_time')
    if a.utcoffset() != b.utcoffset():
        require(fold in (0, 1), 'ambiguous_local_time_choose_fold')
    return dt.replace(tzinfo=a.tzinfo, fold=fold or 0)

def validate_timing(data):
    zone(data['timezone'])
    try:
        if data['all_day']:
            start, end = date.fromisoformat(data['start']), date.fromisoformat(data['end'])
        else:
            start = local_datetime(data['start'], data['timezone'], data.get('fold'))
            end = local_datetime(data['end'], data['timezone'], data.get('end_fold'))
        require((end > start) if data['all_day'] else (end.astimezone(UTC) > start.astimezone(UTC)), 'end_must_follow_start')
        rule = data.get('rrule', '').upper().strip()
        require('\n' not in rule and len(rule) < 600, 'invalid_recurrence')
        if rule:
            parts = dict(p.split('=', 1) for p in rule.removeprefix('RRULE:').split(';'))
            require(parts.get('FREQ') in ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'), 'invalid_recurrence')
            require(set(parts) <= {'FREQ','INTERVAL','BYDAY','BYMONTHDAY','BYMONTH','BYSETPOS','COUNT','UNTIL','WKST'}, 'invalid_recurrence')
            require(not ('COUNT' in parts and 'UNTIL' in parts), 'count_or_until')
            require(int(parts.get('INTERVAL', '1')) > 0, 'invalid_recurrence')
            if 'COUNT' in parts:
                require(1 <= int(parts['COUNT']) <= 10000, 'invalid_recurrence')
            rrulestr(rule, dtstart=base_datetime(data))
        data['rrule'] = rule
    except (ValueError, TypeError, OverflowError):
        raise Problem(400, 'invalid_timing_or_recurrence')

def base_datetime(data):
    if data['all_day']:
        return datetime.combine(date.fromisoformat(data['start']), datetime.min.time(), zone(data['timezone']))
    return local_datetime(data['start'], data['timezone'], data.get('fold'))

def recurrence_starts(data,after=None,limit=None):
    """RRULE COUNT counts valid instances; nonexistent DST times do not count."""
    base=base_datetime(data);rule=data.get('rrule','').removeprefix('RRULE:')
    parts=dict(p.split('=',1) for p in rule.split(';')) if rule else {}
    total=int(parts.pop('COUNT')) if 'COUNT' in parts else None
    if rule:
        parsed=rrulestr(';'.join(k+'='+v for k,v in parts.items()),dtstart=base)
        values=iter(parsed) if total else parsed.xafter(after or base,inc=True)
    else:values=[base]
    valid=yielded=0
    for dt in values:
        if dt.astimezone(UTC).astimezone(dt.tzinfo).replace(tzinfo=None)!=dt.replace(tzinfo=None):continue
        valid+=1
        if total is not None and valid>total:break
        if after is not None and dt<after:continue
        yield dt;yielded+=1
        if limit is not None and yielded>=limit:break

def occurrences(data, start, end, limit=2000):
    """Expand in event timezone; all-day values remain floating calendar dates."""
    base = base_datetime(data)
    if data['all_day']:
        duration = timedelta(days=(date.fromisoformat(data['end']) - date.fromisoformat(data['start'])).days)
    else:
        duration = datetime.fromisoformat(data['end']) - datetime.fromisoformat(data['start'])
    values=recurrence_starts(data,start.astimezone(base.tzinfo)-duration-timedelta(days=2),limit+1)
    count = 0
    for dt in values:
        if dt > end.astimezone(base.tzinfo) + timedelta(days=2):
            break
        # RFC 5545: nonexistent local recurrence instances are ignored.
        if dt.astimezone(UTC).astimezone(dt.tzinfo).replace(tzinfo=None) != dt.replace(tzinfo=None):
            continue
        finish = dt + duration
        if finish < start - timedelta(days=2):
            continue
        count += 1
        require(count <= limit, 'too_many_occurrences_reduce_range')
        key = dt.date().isoformat() if data['all_day'] else dt.replace(tzinfo=None).isoformat(timespec='minutes')
        yield key, dt, finish

def instance(data, key, begin, end, override=None):
    result = dict(data)
    result['start'] = begin.date().isoformat() if data['all_day'] else begin.replace(tzinfo=None).isoformat(timespec='minutes')
    result['end'] = end.date().isoformat() if data['all_day'] else end.replace(tzinfo=None).isoformat(timespec='minutes')
    override=override or {}
    if any(k in override and override[k]!=data.get(k) for k in ('title','description')):
        result['translations']={}
        result.pop('smart',None)
    result.update(override)
    result['occurrence'] = key
    if not result['all_day']:
        result['start_utc'] = local_datetime(result['start'], result['timezone'], result.get('fold', 0)).astimezone(UTC).isoformat()
        result['end_utc'] = local_datetime(result['end'], result['timezone'], result.get('end_fold', 0)).astimezone(UTC).isoformat()
    return result


def remap_override_keys(before, after, overrides, anchor=None):
    """Retain exception identity by ordinal when a series anchor/rule changes.

    Refuse an unmappable edit rather than silently losing text, reminders or AI
    corrections. Explicitly moved occurrence start/end values remain explicit.
    """
    if not overrides:
        return {}
    needed=set(overrides)
    old_indices={}
    for index,begin in enumerate(recurrence_starts(before,anchor,10001)):
        require(index<10000,'recurrence_exceptions_need_review',409)
        key=begin.date().isoformat() if before['all_day'] else begin.replace(tzinfo=None).isoformat(timespec='minutes')
        if key in needed:old_indices[key]=index
        if len(old_indices)==len(needed):break
        if key>max(needed):break
    require(len(old_indices)==len(needed),'recurrence_exceptions_need_review',409)
    max_index=max(old_indices.values())
    new_starts=list(recurrence_starts(after,limit=max_index+1))
    require(len(new_starts)>max_index,'recurrence_exceptions_need_review',409)
    result={}
    for old,patch in overrides.items():
        begin=new_starts[old_indices[old]]
        key=begin.date().isoformat() if after['all_day'] else begin.replace(tzinfo=None).isoformat(timespec='minutes')
        require(key not in result,'recurrence_exceptions_need_review',409)
        result[key]=patch
    return result
