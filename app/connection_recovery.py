"""One-time recovery of accounts halted by the old single-401 policy."""
import logging
from .recurrence import stamp

logger=logging.getLogger(__name__)


def recover_legacy(service, provider):
    assert provider in ('google','icloud')
    with service.db.transaction() as c:
        first=c.execute('INSERT OR IGNORE INTO runtime(key,value) VALUES(?,?)',
                        (provider+'_connection_recovery_v1',stamp()))
        if not first.rowcount:return
        rows=c.execute(f"""SELECT a.id FROM {provider}_accounts a
            JOIN calendars ca ON ca.id=a.calendar_id
            JOIN members m ON m.user_id=a.user_id AND m.calendar_id=ca.id
            WHERE a.state='needs_reconnect' AND a.credentials IS NOT NULL
            AND ca.state='active' AND m.active=1 AND EXISTS
            (SELECT 1 FROM {provider}_sources s WHERE s.account_id=a.id AND s.selected=1)""").fetchall()
        for row in rows:
            c.execute(f"UPDATE {provider}_accounts SET state='connected',last_error='',generation=generation+1 WHERE id=?",(row['id'],))
            c.execute(f"UPDATE {provider}_sources SET state='recovering',last_error='',next_at='' WHERE account_id=? AND selected=1",(row['id'],))
    logger.info('%s legacy_recovery_queued count=%s',provider,len(rows))
