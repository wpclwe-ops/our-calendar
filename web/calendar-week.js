/* Week windows and wall-clock columns, independent of the device timezone. */
(function(root){
 'use strict';
 const add=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 function days(selected,layout='agenda'){
  const offset=(new Date(selected+'T12:00:00Z').getUTCDay()+6)%7;
  const monday=add(selected,-offset),start=layout==='three'?Math.min(offset,4):0;
  return Array.from({length:layout==='three'?3:7},(_,i)=>add(monday,start+i));
 }
 function groups(events,day,zone,local){
  const next=add(day,1),minute=value=>Number(value.slice(11,13))*60+Number(value.slice(14,16));
  const items=events.filter(e=>!e.all_day).map(event=>{
   const a=local(event.start_utc,zone),b=local(event.end_utc,zone);
   if(a.slice(0,10)>=next||b<=day+'T00:00')return null;
   const start=a.slice(0,10)<day?0:minute(a),rawEnd=b.slice(0,10)>day?1440:minute(b);
   // A repeated DST hour may have an earlier wall-clock end. Keep it reachable.
   return {event,start,end:Math.min(1440,Math.max(start+1,rawEnd))};
  }).filter(Boolean).sort((a,b)=>a.start-b.start||b.end-a.end||a.event.id.localeCompare(b.event.id));
  const result=[];
  for(const item of items){
   let group=result.at(-1);
   if(!group||item.start>=group.end){group={end:item.end,items:[],lanes:[]};result.push(group)}
   group.end=Math.max(group.end,item.end);
   let lane=group.lanes.findIndex(end=>end<=item.start);if(lane<0)lane=group.lanes.length;
   group.lanes[lane]=item.end;item.lane=lane;group.items.push(item);
  }
  return result;
 }
 const api={days,groups};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CalendarWeek=api;
})(globalThis);
