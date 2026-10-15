"""Optional repeatable sample data. Refuses to run in production."""
from datetime import datetime,timedelta
from app.config import Config
from app.db import Database
from app.service import Service
config=Config.env()
if not config.demo:raise SystemExit('DEMO_MODE=true required')
s=Service(Database(config.database),config)
with s.db.transaction() as c:
    for i,name in [(1,'Рита'),(2,'Partner')]:s.ensure_user(c,{'id':i,'first_name':name,'language_code':'ru' if i==1 else 'en'})
if not s.state('1')['calendar']:
    s.create_calendar('1');s.join('2',s.invite('1')['token'])
    category=s.save_category('1',{'name':'Наши планы','color':'#9B77D1','translations':{'en':'Our plans'}})
    today=datetime.now().date()
    for offset,hour,title in [(0,12,'Время вместе'),(0,13,'Прогулка по городу'),(2,10,'Завтрак вдвоём'),(6,19,'Вечер кино')]:
        day=(today+timedelta(days=offset)).isoformat()
        s.save_event('1',{'title':title,'start':f'{day}T{hour:02d}:00','end':f'{day}T{hour+2:02d}:00',
                          'category_id':category['id'],'owner':'both'})
print('Demo ready')
