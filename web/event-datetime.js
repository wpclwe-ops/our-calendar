/* App-owned date/time dialog. All arithmetic uses the event's zone, never the device zone. */
(function(root){
 'use strict';
 const T=root.CalendarTime||(typeof require==='function'?require('./calendar-time.js'):null);
 const pad=n=>String(n).padStart(2,'0'),mod=(n,size)=>(n%size+size)%size;
 const foldKey=field=>field==='start'?'fold':'end_fold';
 const wallNumber=value=>Date.parse(value+'Z');
 const minute=value=>value.slice(0,16);
 function validWall(value){
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?$/.test(value)&&Number(value.slice(0,4))>=1&&Number.isFinite(wallNumber(value))&&new Date(wallNumber(value)).toISOString().slice(0,16)===minute(value);
 }
 function resolve(value,zone,fold,explicit=false){
  if(!validWall(value))throw new Error('invalid_datetime');
  const wall=minute(value),first=T.resolve(wall,zone,0),second=T.resolve(wall,zone,1);
  if(explicit&&first!==second&&fold!==0&&fold!==1)throw new Error('ambiguous_local_time_choose_fold');
  return (fold===1?second:first)+(wallNumber(value)-wallNumber(wall));
 }
 function elapsed(data){
  try{return (resolve(data.end,data.timezone,data.end_fold)-resolve(data.start,data.timezone,data.fold))/60000}
  catch{return (wallNumber(data.end)-wallNumber(data.start))/60000}
 }
 function ending(data,minutes){
  try{
   const end=resolve(data.start,data.timezone,data.fold)+minutes*60000,value=T.local(new Date(end),data.timezone);
   return {end:value,end_fold:T.resolve(value,data.timezone,0)===end?0:1};
  }catch{return {end:T.add(minute(data.start),minutes),end_fold:undefined}}
 }
 function model(options){
  let data={start:options.start,end:options.end,timezone:options.timezone,fold:options.fold,end_fold:options.end_fold,manualEnd:Boolean(options.manualEnd)};
  // A draft changes date/hour/minute separately. Intermediate invalid positions must not replace the user's end anchor.
  let anchor={...data},generated=null;
  const value=()=>({...data});
  function status(){
   const errors=[],ambiguous={};let start,end;
   for(const field of ['start','end'])try{
    const a=resolve(data[field],data.timezone,0),b=resolve(data[field],data.timezone,1);ambiguous[field]=a!==b;
    const actual=resolve(data[field],data.timezone,data[foldKey(field)],true);if(field==='start')start=actual;else end=actual;
   }catch(error){errors.push({field,code:error.message==='Invalid time zone specified: '+data.timezone?'invalid_timezone':error.name==='RangeError'?'invalid_timezone':error.message})}
   if(!errors.length&&end<=start)errors.push({field:'end',code:'end_must_follow_start'});
   return {valid:errors.length===0,errors,ambiguous,minutes:errors.length?null:(end-start)/60000};
  }
  function change(field,next,kind){
   if(next===data[field])return;
   if(!validWall(next))throw new Error('invalid_datetime');
   const duration=Math.max(1,elapsed(anchor)||60);
   data[field]=next;data[foldKey(field)]=undefined;
   if(field==='start'){
    let keep=false;
    if(data.manualEnd)try{keep=resolve(anchor.end,anchor.timezone,anchor.end_fold)>resolve(next,data.timezone,data.fold)}catch{}
    if(keep){data.end=anchor.end;data.end_fold=anchor.end_fold;generated=null}else{Object.assign(data,ending(data,duration));generated={minutes:duration}}
   }else{
    data.manualEnd=true;generated=null;
    if(kind==='time'&&next.slice(0,10)===data.start.slice(0,10)&&next<=data.start)data.end=T.add(next,1440);
    anchor={...data};
   }
  }
  return {value,status,checkpoint:()=>({data:{...data},anchor:{...anchor},generated:generated?{...generated}:null}),restore:checkpoint=>{data={...(checkpoint.data||checkpoint)};anchor={...(checkpoint.anchor||data)};generated=checkpoint.generated?{...checkpoint.generated}:null},
   setDate(field,date){change(field,date+data[field].slice(10),'date')},
   setClock(field,part,n){
    const wall=minute(data[field]),h=part==='hour'?pad(mod(n,24)):wall.slice(11,13),m=part==='minute'?pad(mod(n,60)):wall.slice(14,16),next=wall.slice(0,10)+'T'+h+':'+m;
    if(next!==wall)change(field,next,'time');
   },
   setFold(field,n){data[foldKey(field)]=Number(n);if(field==='start'&&generated)Object.assign(data,ending(data,generated.minutes));else if(field==='end')generated=null;anchor={...data}},
   setDuration(n){if(!Number.isInteger(n)||n<1||n>525600)throw new Error('invalid_duration');Object.assign(data,ending(data,n));data.manualEnd=true;anchor={...data};generated={minutes:n}}
  };
 }
 const words={
  ru:{dateTime:'Дата и время',start:'Начало',end:'Конец',startDate:'Дата начала',endDate:'Дата окончания',hours:'Часы',minutes:'Минуты',duration:'Длительность',cancel:'Отмена',done:'Готово',close:'Закрыть',previous:'Предыдущий месяц',next:'Следующий месяц',first:'Первый',second:'Второй',repeated:'Этот час повторяется. Выберите вариант.',invalid_datetime:'Проверьте дату и время.',invalid_timezone:'Проверьте часовой пояс события.',nonexistent_local_time:'Такого времени нет из-за перехода на летнее время.',ambiguous_local_time_choose_fold:'Выберите первый или второй вариант повторяющегося часа.',end_must_follow_start:'Окончание должно быть позже начала.',invalid_duration:'Проверьте длительность.',startLabel:'Начало',endLabel:'Конец'},
  en:{dateTime:'Date & time',start:'Start',end:'End',startDate:'Start date',endDate:'End date',hours:'Hours',minutes:'Minutes',duration:'Duration',cancel:'Cancel',done:'Done',close:'Close',previous:'Previous month',next:'Next month',first:'First',second:'Second',repeated:'This hour occurs twice. Choose an occurrence.',invalid_datetime:'Check the date and time.',invalid_timezone:'Check the event time zone.',nonexistent_local_time:'This local time does not exist because of daylight saving time.',ambiguous_local_time_choose_fold:'Choose the first or second occurrence of this hour.',end_must_follow_start:'End must be after start.',invalid_duration:'Check the duration.',startLabel:'Start',endLabel:'End'}
 };
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function dateText(value,language,options){return new Intl.DateTimeFormat(language==='en'?'en-GB':'ru-RU',{timeZone:'UTC',...options}).format(new Date(value.slice(0,10)+'T12:00:00Z'))}
 function durationText(n,language){
  if(n===null||!Number.isFinite(n)||n<=0)return '—';
  const rounded=Math.round(n),days=Math.floor(rounded/1440),hours=Math.floor(rounded%1440/60),minutes=rounded%60;
  const forms=new Intl.PluralRules(language),unit=(n,en,ru)=>language==='en'?n+' '+en+(n===1?'':'s'):n+' '+ru[{one:0,few:1,other:2,many:2}[forms.select(n)]??2];
  return [days?unit(days,'day',['день','дня','дней']):'',hours?unit(hours,'hour',['час','часа','часов']):'',minutes?(language==='en'?minutes+' min':minutes+' мин'):''].filter(Boolean).join(' ')||(language==='en'?'<1 min':'<1 мин');
 }
 let live=null;
 function open(options){
  if(live)live.close();
  const data=model(options),language=options.language==='en'?'en':'ru',w=words[language],t=k=>w[k]||k;
  const el=document.createElement('div');el.className='modal-backdrop event-datetime-backdrop';
  let field=options.field==='end'?'end':'start',calendarOpen=false,month=data.value()[field].slice(0,7)+'-01',closed=false;
  const controller=new AbortController(),listen=(target,type,fn,opts={})=>target.addEventListener(type,fn,{...opts,signal:controller.signal});
  const $=s=>el.querySelector(s),$$=s=>[...el.querySelectorAll(s)],wheels=new Map(),previous=document.activeElement,app=document.querySelector('#app'),wasInert=app?.inert;
  const scroll=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';if(app)app.inert=true;
  el.innerHTML=`<section class="modal event-datetime-picker" role="dialog" aria-modal="true" aria-labelledby="event-datetime-title"><div class="ed-header"><h2 id="event-datetime-title">${t('dateTime')}</h2><button type="button" data-ed-close aria-label="${t('close')}">×</button></div><div class="ed-tabs" role="group" aria-label="${t('dateTime')}">${['start','end'].map(key=>`<button type="button" data-ed-tab="${key}"><span>${t(key)}</span><strong data-ed-time="${key}"></strong><small data-ed-day="${key}"></small></button>`).join('')}</div><button type="button" class="ed-date" data-ed-date-toggle aria-expanded="false"><span><small data-ed-date-caption></small><strong data-ed-date-label></strong></span><span class="ed-chevron" aria-hidden="true">⌄</span></button><section class="ed-calendar" aria-label="${t('dateTime')}" hidden><div class="ed-month-header"><button type="button" data-ed-month="-1" aria-label="${t('previous')}">‹</button><strong data-ed-month-label></strong><button type="button" data-ed-month="1" aria-label="${t('next')}">›</button></div><div class="ed-weekdays" aria-hidden="true"></div><div class="ed-days"></div></section><section class="ed-time" aria-label="${t('dateTime')}"><div class="ed-wheel-labels"><span>${t('hours')}</span><span></span><span>${t('minutes')}</span></div><div class="ed-drums"><div class="ed-selection" aria-hidden="true"></div>${['hour','minute'].map((name,i)=>`${i?'<span class="ed-colon" aria-hidden="true">:</span>':''}<button type="button" class="ed-wheel" data-ed-wheel="${name}" role="spinbutton" aria-label="${t(i?'minutes':'hours')}" aria-valuemin="0" aria-valuemax="${i?59:23}"><span class="ed-track" aria-hidden="true"></span></button>`).join('')}</div></section><div class="ed-folds"></div><section class="ed-duration"><div class="ed-duration-caption"><span>${t('duration')}</span><strong data-ed-duration-label></strong></div><div class="ed-presets" role="group" aria-label="${t('duration')}">${[30,60,90,120].map(n=>`<button type="button" data-ed-duration="${n}">${esc(n===90?(language==='ru'?'1,5 ч':'1.5 h'):durationText(n,language))}</button>`).join('')}</div></section><div class="ed-zone">${esc(options.timezone)}</div><div class="ed-error" role="alert" hidden></div><footer class="ed-footer"><button type="button" data-ed-cancel>${t('cancel')}</button><button type="button" class="primary" data-ed-done>${t('done')}</button></footer></section>`;
  document.body.append(el);
  const activeValue=name=>Number(data.value()[field].slice(name==='hour'?11:14,name==='hour'?13:16));
  function drawWheel(name,offset=0){
   const wheel=$('[data-ed-wheel='+name+']'),value=activeValue(name),count=name==='hour'?24:60,track=wheel.querySelector('.ed-track');
   track.innerHTML=Array.from({length:9},(_,i)=>{const k=i-4;return `<span class="ed-number ${k===0?'selected':''}" data-ed-offset="${k}">${pad(mod(value+k,count))}</span>`}).join('');
   [...track.children].forEach((row,i)=>{const k=i-4;row.style.top=k*44+'px';row.style.transform=`scale(${1-Math.min(4,Math.abs(k))*.075})`;row.style.opacity=1-Math.min(4,Math.abs(k))*.12});
   track.style.transform=`translateY(${offset}px)`;wheel.setAttribute('aria-valuenow',value);wheel.setAttribute('aria-valuetext',pad(value));
  }
  function summary(){
   const v=data.value(),status=data.status();
   $$('[data-ed-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.edTab===field)));
   for(const key of ['start','end']){$('[data-ed-time='+key+']').textContent=v[key].slice(11,16);$('[data-ed-day='+key+']').textContent=dateText(v[key],language,{day:'numeric',month:'long',year:'numeric'})}
   $('[data-ed-date-caption]').textContent=t(field==='start'?'startDate':'endDate');$('[data-ed-date-label]').textContent=dateText(v[field],language,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
   $('[data-ed-duration-label]').textContent=durationText(status.minutes,language);$$('[data-ed-duration]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.edDuration)===status.minutes)));
   $('.ed-error').hidden=status.valid;$('.ed-error').textContent=status.errors.map(e=>t(e.field)+': '+t(e.code)).join(' ');$('[data-ed-done]').disabled=!status.valid;
   $('.ed-folds').innerHTML=['start','end'].filter(key=>status.ambiguous[key]).map(key=>`<fieldset class="ed-fold"><legend>${t(key)} · ${t('repeated')}</legend>${[0,1].map(n=>`<label><input type="radio" name="ed-fold-${key}" data-ed-fold="${key}" value="${n}" ${v[foldKey(key)]===n?'checked':''}>${t(n?'second':'first')}</label>`).join('')}</fieldset>`).join('');
  }
  function refresh(){summary();for(const [name,s] of wheels)drawWheel(name,s.offset)}
  function calendar(){
   const first=new Date(month+'T12:00:00Z'),offset=(first.getUTCDay()+6)%7,last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1,0);
   const start=new Date(first);start.setUTCDate(start.getUTCDate()-offset);const count=Math.ceil((offset+last.getUTCDate())/7)*7;
   $('[data-ed-month-label]').textContent=dateText(month,language,{month:'long',year:'numeric'});
   $('[data-ed-month="-1"]').disabled=month==='0001-01-01';$('[data-ed-month="1"]').disabled=month==='9999-12-01';
   $('.ed-weekdays').innerHTML=Array.from({length:7},(_,i)=>{const d=new Date('2026-10-12T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);return `<span>${esc(dateText(d.toISOString(),language,{weekday:'short'}))}</span>`}).join('');
   $('.ed-days').innerHTML=Array.from({length:count},(_,i)=>{const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);const date=d.toISOString().slice(0,10),invalid=d.getUTCFullYear()<1||d.getUTCFullYear()>9999;return `<button type="button" data-ed-day-choice="${esc(date)}" class="${date.slice(0,7)!==month.slice(0,7)?'outside':''}" aria-pressed="${date===data.value()[field].slice(0,10)}" aria-label="${invalid?'—':esc(dateText(date,language,{day:'numeric',month:'long',year:'numeric'}))}" ${invalid?'disabled':''}>${d.getUTCDate()}</button>`}).join('');
  }
  function toggleDate(open){calendarOpen=open;$('.ed-calendar').hidden=!open;$('.ed-time').hidden=open;$('[data-ed-date-toggle]').setAttribute('aria-expanded',String(open));if(open){month=data.value()[field].slice(0,7)+'-01';calendar()}}
  function stopWheels(restore=false){for(const [name,s] of wheels){clearTimeout(s.timer);cancelAnimationFrame(s.frame);if(restore&&s.drag)data.restore(s.drag.checkpoint);s.drag=null;s.offset=0;s.acc=0;s.node.classList.remove('dragging');if(!closed)drawWheel(name)}}
  function close(){if(closed)return;stopWheels();closed=true;controller.abort();el.remove();document.documentElement.style.overflow=scroll;if(app)app.inert=wasInert;if(previous?.isConnected)previous.focus({preventScroll:true});live=null;options.onClose?.()}
  live={close};
  listen(el,'click',e=>{
   const b=e.target.closest('button');if(e.target===el||b?.matches('[data-ed-close],[data-ed-cancel]')){close();return}
   if(!b)return;
   if(b.hasAttribute('data-ed-tab')){stopWheels();field=b.dataset.edTab;toggleDate(false);refresh()}
   else if(b.hasAttribute('data-ed-date-toggle')){stopWheels();toggleDate(!calendarOpen)}
   else if(b.hasAttribute('data-ed-month')){const d=new Date(month+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+Number(b.dataset.edMonth));month=d.toISOString().slice(0,10);calendar()}
   else if(b.hasAttribute('data-ed-day-choice')){data.setDate(field,b.dataset.edDayChoice);toggleDate(false);refresh();$('[data-ed-date-toggle]').focus()}
   else if(b.hasAttribute('data-ed-duration')){stopWheels();data.setDuration(Number(b.dataset.edDuration));refresh()}
   else if(b.hasAttribute('data-ed-done')){stopWheels();if(!data.status().valid)return;const result=data.value();close();options.onApply(result)}
  });
  listen(el,'change',e=>{if(e.target.hasAttribute('data-ed-fold')){const key=e.target.dataset.edFold,n=e.target.value;data.setFold(key,n);refresh();$(`[data-ed-fold="${key}"][value="${n}"]`).focus()}});
  for(const name of ['hour','minute']){
   const node=$('[data-ed-wheel='+name+']'),s={node,offset:0,drag:null,acc:0,timer:0,frame:0};wheels.set(name,s);
   const snap=()=>{s.offset=0;s.acc=0;node.classList.remove('dragging');drawWheel(name)};
   const move=delta=>{const steps=Math.round(delta/44);s.offset=-delta+steps*44;data.setClock(field,name,s.drag.base+steps);refresh()};
   listen(node,'pointerdown',e=>{
    if(!e.isPrimary||e.button>0)return;stopWheels();e.preventDefault();node.focus({preventScroll:true});
    s.drag={id:e.pointerId,y:e.clientY,base:activeValue(name),moved:false,checkpoint:data.checkpoint()};node.setPointerCapture(e.pointerId);node.classList.add('dragging');
   });
   listen(node,'pointermove',e=>{if(!s.drag||s.drag.id!==e.pointerId)return;e.preventDefault();const delta=s.drag.y-e.clientY;if(Math.abs(delta)>5)s.drag.moved=true;move(delta)});
   const finish=(e,cancel)=>{if(!s.drag||s.drag.id!==e.pointerId)return;const drag=s.drag;s.drag=null;
    if(cancel)data.restore(drag.checkpoint);
    else if(!drag.moved){const box=node.getBoundingClientRect();data.setClock(field,name,activeValue(name)+Math.round((e.clientY-(box.top+box.height/2))/44))}
    if(node.hasPointerCapture(e.pointerId))node.releasePointerCapture(e.pointerId);snap();refresh();
   };
   listen(node,'pointerup',e=>finish(e,false));listen(node,'pointercancel',e=>finish(e,true));listen(node,'lostpointercapture',e=>{if(s.drag)finish(e,true)});
   listen(node,'wheel',e=>{e.preventDefault();clearTimeout(s.timer);node.classList.add('dragging');s.acc+=e.deltaY*(e.deltaMode===1?16:1);const steps=Math.trunc(s.acc/24);s.acc-=steps*24;s.offset=-s.acc/24*44;if(steps)data.setClock(field,name,activeValue(name)+steps);refresh();s.timer=setTimeout(snap,130)},{passive:false});
   listen(node,'keydown',e=>{const delta={ArrowUp:-1,ArrowDown:1,PageUp:-5,PageDown:5}[e.key];if(delta!==undefined||e.key==='Home'||e.key==='End'){e.preventDefault();stopWheels();data.setClock(field,name,delta!==undefined?activeValue(name)+delta:e.key==='Home'?0:name==='hour'?23:59);refresh()}});
   listen(node,'click',e=>e.preventDefault());listen(node,'contextmenu',e=>e.preventDefault());
  }
  listen(el,'pointerdown',e=>{if(!e.isPrimary){stopWheels(true);refresh()}},{capture:true});
  listen(window,'blur',()=>{stopWheels(true);refresh()});listen(document,'visibilitychange',()=>{if(document.hidden){stopWheels(true);refresh()}});
  listen(el,'keydown',e=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(calendarOpen)toggleDate(false);else close()}
   if(e.key==='Tab'){const controls=$$('button:not([disabled]),input:not([disabled])').filter(n=>n.getClientRects().length),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
  });
  refresh();$('[data-ed-close]').focus();return live;
 }
 const api={model,resolve,dateText,durationText,open};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EventDateTime=api;
})(globalThis);
