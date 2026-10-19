/* Wall-clock arithmetic never depends on the browser's own time zone. */
(function(root){
 'use strict';
 const formatters=new Map();
 const formatter=(locale,options)=>{const key=locale+JSON.stringify(Object.entries(options).sort(([a],[b])=>a<b?-1:a>b?1:0));let f=formatters.get(key);if(!f){f=new Intl.DateTimeFormat(locale,options);formatters.set(key,f)}return f};
 function local(value,zone){
  const p=Object.fromEntries(formatter('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
 }
 const add=(value,minutes)=>new Date(Date.parse(value+'Z')+minutes*60000).toISOString().slice(0,16);
 function defaults(day,zone,duration=60,now=new Date(),minutes){
  const start=day+'T'+(minutes===undefined?local(now,zone).slice(11):String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0'));
  return {start,end:add(start,duration)};
 }
 function moveStart(previous,next,manualEnd=false){
  const duration=Math.max(1,(Date.parse(previous.end+'Z')-Date.parse(previous.start+'Z'))/60000);
  return {start:next,end:manualEnd&&previous.end>next?previous.end:add(next,duration)};
 }
 function candidates(value,zone){
  const naive=Date.parse(value+'Z'),offsets=new Set();
  for(const hours of [-36,0,36]){
   const instant=naive+hours*3600000;
   offsets.add(Date.parse(local(instant,zone)+'Z')-instant);
  }
  return [...offsets].map(offset=>naive-offset).filter(instant=>local(instant,zone)===value).sort((a,b)=>a-b);
 }
 function resolve(value,zone,fold=0){
  const matches=candidates(value,zone);
  if(!matches.length)throw new Error('nonexistent_local_time');
  return matches[Math.min(fold,matches.length-1)];
 }
 function fields(instant,zone){
  const value=local(instant,zone),matches=candidates(value,zone);
  return {value,fold:Math.max(0,matches.indexOf(instant))};
 }
 function moveEvent(event,day,minutes,viewerZone){
  const wall=add(day+'T00:00',minutes);
  const begin=resolve(wall,viewerZone,event.fold||0),finish=begin+(Date.parse(event.end_utc)-Date.parse(event.start_utc));
  const a=fields(begin,event.timezone),b=fields(finish,event.timezone);
  return {start:a.value,end:b.value,fold:a.fold,end_fold:b.fold};
 }
 const api={local,add,defaults,moveStart,resolve,moveEvent};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CalendarTime=api;
})(globalThis);
