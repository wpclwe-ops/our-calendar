/* Isolated UI fixture. No requests reach calendar APIs; no real identities or data.
 * Open design-preview.html for a reproducible interface review. */
'use strict';
(()=>{
 const params=new URLSearchParams(location.search||new URL(document.currentScript.src).search);
 if(params.get('phone')==='1'){
  const app=document.getElementById('app');app.className='hidden';
  const frame=document.createElement('iframe');frame.title='Mobile interface preview';
  frame.style.cssText='display:block;width:390px;height:844px;max-width:100%;border:0;margin:24px auto;box-shadow:0 4px 24px #0002;border-radius:20px';
  const query=new URLSearchParams({lang:params.get('lang')||'ru',theme:params.get('theme')||'light'});
  frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/style.css"><script src="/assets/design-preview.js?'+query.toString().replaceAll('&','&amp;')+'" defer></scr'+'ipt><script src="/assets/app.js" defer></scr'+'ipt></head><body><div id="app"></div><div id="toast" role="status"></div></body></html>';
  document.body.append(frame);
  window.fetch=async()=>new Response(JSON.stringify({demo:false}),{headers:{'Content-Type':'application/json'}});return;
 }
 const today=new Date().toISOString().slice(0,10),month=today.slice(0,7);
 const members=[{id:'1',name:'Alex',active:true},{id:'2',name:'Partner',active:true}];
 const me={id:'1',name:'Alex',language:params.get('lang')==='en'?'en':'ru',theme:params.get('theme')==='dark'?'dark':'light',timezone:'Europe/Warsaw',timezone_initialized:true,view:'month',notify_at_start:true,default_reminders:[60,15],reminders_enabled:true,bot_can_message:true};
 const state={me,calendar:{id:'preview',first_id:'1',second_id:'2',state:'active',active:true,votes:[],created_at:month+'-01T12:00:00Z'},members,restores:[]};
 let categories=[{id:'work',name:'Работа и учёба',color:'#7778C9',translations:{en:'Work & study'}},{id:'social',name:'Встречи',color:'#D47AAE',translations:{en:'Social'}},{id:'home',name:'Дом',color:'#55A77B',translations:{en:'Home'}},{id:'sport',name:'Спорт',color:'#4DA5A8',translations:{en:'Sport'}},{id:'travel',name:'Поездки',color:'#598DD4',translations:{en:'Travel'}},{id:'health',name:'Здоровье',color:'#D77777',translations:{en:'Health'}}];
 const events=[];
 const add=(day,hour,title,en,category_id,owner='both',status='planned',duration=60)=>{
  const date=month+'-'+String(day).padStart(2,'0'),start=date+'T'+hour,end=new Date(new Date(start+':00Z').getTime()+duration*60000).toISOString().slice(0,16);
  const e={id:'preview-'+events.length,revision:1,title,description:'Общие планы на этот день.',language:'ru',translations:{en:{title:en,description:'Our plans for the day.'}},start,end,all_day:false,timezone:'Europe/Warsaw',owner,category_id,status,location:'',links:[],rrule:'',reminders:{'1':[60,15],'2':[60]},occurrence:start};
  e.start_utc=start+':00+02:00';e.end_utc=end+':00+02:00';events.push(e);return e;
 };
 [2,6,9,13,16,20,23,27].forEach((d,i)=>add(d,'09:30','Урок нидерландского','Dutch lesson','work','1',i<4?'done':'planned'));
 [5,12,19,26].forEach((d,i)=>add(d,'18:00','Йога','Yoga','sport','1',i<2?'done':'planned'));
 add(10,'10:00','Покупки для дома','Home shopping','home','both','done');
 add(15,'13:00','Позвонить арендодателю','Call landlord',null,'2');
 add(15,'18:00','Тренировка','Gym','sport','2');
 add(15,'18:30','Забрать цветы','Pick up flowers','home','1');
 add(15,'19:30','Ужин с друзьями','Dinner with friends','social','both','planned',150);
 add(16,'19:00','Вечер вдвоём','Date night','social');
 add(17,'11:00','Стирка','Laundry','home','2');
 add(20,'08:30','Приём у врача','GP check-up','health','1');
 add(28,'19:00','Сходить в кино','Cinema','social','both','cancelled');
 add(31,'20:00','Хэллоуин 🎃','Halloween party','social');
 const trip=add(22,'08:00','Поездка во Вроцлав','Wrocław trip','travel');Object.assign(trip,{all_day:true,start:month+'-22',end:month+'-26',occurrence:month+'-22'});
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const normalize=e=>{if(!e.all_day){e.start_utc=e.start+':00+02:00';e.end_utc=e.end+':00+02:00'}e.occurrence=e.start;return e};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.origin),path=url.pathname,method=options.method||'GET',body=options.body?JSON.parse(options.body):{};
  if(url.origin!==location.origin||!path.startsWith('/api/'))return reply({error:'preview_only'},400);
  if(path==='/api/config')return reply({demo:true,bot_username:'',integrations:{translation:'not_configured'}});
  if(path==='/api/auth')return reply({token:'preview-only-no-session',state});
  if(path==='/api/state')return reply(state);
  if(path==='/api/settings'){Object.assign(me,body);return reply(state)}
  if(path==='/api/categories'){
   if(method==='POST'){const c={...body,id:'category-'+Date.now()};categories.push(c);return reply(c)}
   return reply(categories);
  }
  if(path.startsWith('/api/categories/')){const id=path.split('/').pop(),index=categories.findIndex(c=>c.id===id);if(method==='DELETE'){categories=categories.filter(c=>c.id!==id);events.forEach(e=>{if(e.category_id===id)e.category_id=null});return reply({ok:true})}Object.assign(categories[index],body);return reply(categories[index])}
  if(path==='/api/events'){
   if(method==='POST'){const e=normalize({...body,id:'event-'+Date.now(),revision:1,status:'planned',reminders:{'1':body.reminders,'2':[60]}});events.push(e);return reply(e)}
   const q=(url.searchParams.get('q')||'').toLowerCase(),owner=url.searchParams.get('owner'),cat=url.searchParams.get('category'),status=url.searchParams.get('status'),trash=url.searchParams.get('trash')==='true';
   return reply(events.filter(e=>Boolean(e.deleted_at)===trash&&(!q||JSON.stringify([e.title,e.translations]).toLowerCase().includes(q))&&(!owner||e.owner===owner)&&(!cat||(e.category_id||'none')===cat)&&(!status||e.status===status)).sort((a,b)=>a.start.localeCompare(b.start)));
  }
  if(path.startsWith('/api/events/')){
   const parts=path.split('/'),e=events.find(e=>e.id===parts[3]);if(!e)return reply({error:'not_found'},404);
   if(parts[4]==='restore'){delete e.deleted_at;return reply({ok:true})}
   if(method==='DELETE'){e.deleted_at=new Date().toISOString();return reply({ok:true})}
   if(method==='PATCH'){const reminders=body.reminders;Object.assign(e,body,{revision:e.revision+1});if(reminders)e.reminders={'1':reminders,'2':[60]};normalize(e);return reply(e)}
   return reply(e);
  }
  return reply({error:'preview_only'},400);
 };
})();
