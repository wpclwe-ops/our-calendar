"""Health information contains no user identities, event text or credentials."""
from datetime import datetime
from .recurrence import utcnow
from .service import load

def health_status(service):
    with service.db.transaction() as c:
        values={r['key']:r['value'] for r in c.execute("SELECT * FROM runtime WHERE key IN ('worker_heartbeat','translation_heartbeat','bot_setup','translation_probe','operator_backup','release_checkpoint','smart_last_result')")}
    now=utcnow()
    def age(value):
        try:return max(0,int((now-datetime.fromisoformat(value)).total_seconds()))
        except (ValueError,TypeError):return None
    heartbeat=values.get('worker_heartbeat');seconds=age(heartbeat)
    ready=seconds is not None and seconds<=120
    translation=load(values['translation_probe']) if values.get('translation_probe') else {'state':'starting' if service.config.translation_url else 'not_configured'}
    if service.config.openai_api_key:
        translation=load(values['smart_last_result']) if values.get('smart_last_result') else {'state':'starting'}
        translation={**translation,'engine':'openai'}
    translation_age=age(translation.get('checked_at'))
    if service.config.translation_url and not service.config.openai_api_key and translation_age is not None and translation_age>600:translation={**translation,'state':'stale'}
    backup=load(values['operator_backup']) if values.get('operator_backup') else {'state':'pending' if service.config.backup_bucket else 'not_configured'}
    backup_age=age(backup.get('last_success'))
    if backup.get('state')=='ready' and backup_age is not None and backup_age>26*3600:backup={**backup,'state':'stale'}
    degraded=not ready or (bool(service.config.translation_url or service.config.openai_api_key) and translation['state']!='ready') or (bool(service.config.backup_bucket) and backup['state']!='ready')
    return {'ok':True,'ready':ready,'degraded':degraded,'version':'0.9.0','demo':service.config.demo,
            'worker_heartbeat':heartbeat,'heartbeat_age_seconds':seconds,'bot_setup':values.get('bot_setup','not_started'),
            'translation':translation,'backup':backup,'release_checkpoint':load(values['release_checkpoint']) if values.get('release_checkpoint') else {'state':'not_requested'}}
