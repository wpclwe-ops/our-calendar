/* Date-only calendar navigation, independent of device time zone. */
(function(root){
 'use strict';
 const VIEWS=['month','week','day'];
 const date=s=>new Date(s+'T12:00:00Z');
 const iso=d=>d.toISOString().slice(0,10);
 function shift(selected,view,n){
  const d=date(selected);
  if(view==='month'){
   const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);
   const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
   d.setUTCDate(Math.min(day,last));
  }else d.setUTCDate(d.getUTCDate()+n*(view==='week'?7:1));
  return iso(d);
 }
 function weekHeading(selected,language='ru'){
  const d=date(selected),first=date(selected.slice(0,7)+'-01');
  const number=Math.floor(((first.getUTCDay()+6)%7+d.getUTCDate()-1)/7)+1;
  const locale=language==='en'?'en-GB':'ru-RU';
  const format=(value,options)=>new Intl.DateTimeFormat(locale,{timeZone:'UTC',...options}).format(value);
  // Russian month in the genitive, as in «3-я неделя октября».
  const month=language==='en'?format(d,{month:'long'}):new Intl.DateTimeFormat(locale,{timeZone:'UTC',day:'numeric',month:'long'}).formatToParts(d).find(p=>p.type==='month').value;
  const start=date(selected);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
  const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
  const sameYear=start.getUTCFullYear()===end.getUTCFullYear(),sameMonth=sameYear&&start.getUTCMonth()===end.getUTCMonth();
  const range=sameMonth?`${start.getUTCDate()}–${format(end,{day:'numeric',month:'long',year:'numeric'})}`:`${format(start,{day:'numeric',month:'long',...(!sameYear?{year:'numeric'}:{})})} – ${format(end,{day:'numeric',month:'long',year:'numeric'})}`;
  return {title:language==='en'?`Week ${number} of ${month}`:`${number}-я неделя ${month}`,range};
 }
 function gesture(dx,dy,width,view){
  if(Math.abs(dx)<44||Math.abs(dx)<Math.abs(dy)*1.5)return null;
  const direction=dx<0?1:-1;
  if(Math.abs(dx)<Math.max(140,Math.min(260,width*.55)))return {type:'move',direction};
  const target=VIEWS[VIEWS.indexOf(view)+direction];
  return target?{type:'view',view:target}:{type:'limit'};
 }
 function mount({enabled,getView,label,run,onError}){
  let drag=null,hint=null,suppressUntil=0;
  const clear=()=>{hint?.remove();hint=null;drag=null};
  document.addEventListener('pointerdown',e=>{
   if(drag){clear();return}
   const surface=e.target.closest?.('.calendar-shell');
   if(!e.isPrimary||e.pointerType==='mouse'||!surface||!enabled()||e.target.closest('header,.calendar-controls,.day-layout-row,input,select,textarea'))return;
   drag={id:e.pointerId,x:e.clientX,y:e.clientY,surface,width:surface.clientWidth,view:getView(),axis:null};
  });
  document.addEventListener('pointermove',e=>{
   if(!drag||e.pointerId!==drag.id)return;
   const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
   if(!drag.axis){
    if(Math.max(Math.abs(dx),Math.abs(dy))<12)return;
    if(Math.abs(dx)<Math.abs(dy)*1.5){clear();return}
    drag.axis='x';drag.surface.setPointerCapture(e.pointerId);
   }
   e.preventDefault();
   const action=gesture(dx,dy,drag.width,drag.view);
   if(!action){hint?.remove();hint=null;return}
   if(!hint){hint=document.createElement('div');hint.className='calendar-swipe-hint';hint.setAttribute('role','status');document.body.append(hint)}
   hint.textContent=label(action);hint.dataset.mode=action.type;
  },{passive:false});
  document.addEventListener('pointerup',e=>{
   if(!drag||e.pointerId!==drag.id)return;
   const action=drag.axis==='x'?gesture(e.clientX-drag.x,e.clientY-drag.y,drag.width,drag.view):null;
   if(drag.axis==='x')suppressUntil=Date.now()+500;
   clear();
   if(action&&action.type!=='limit'&&enabled())Promise.resolve().then(()=>run(action)).catch(onError);
  });
  document.addEventListener('pointercancel',clear);
  document.addEventListener('click',e=>{
   if(Date.now()<suppressUntil&&e.detail>0){e.preventDefault();e.stopImmediatePropagation()}
  },true);
  window.addEventListener('blur',clear);
  return {active:()=>Boolean(drag),cancel:clear};
 }
 const api={shift,weekHeading,gesture,mount};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CalendarNavigation=api;
})(globalThis);
