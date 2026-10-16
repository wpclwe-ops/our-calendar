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
 function motion({preview,haptic=()=>{}}){
  const viewport=document.querySelector('.calendar-motion-viewport'),current=viewport?.querySelector('.calendar-motion-page');
  if(!current)return null;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,width=viewport.clientWidth;
  let incoming=null,key='',dx=0,ended=false,frame=0,lastType='',animations=[],retired=[];
  const animate=(el,frames)=>{
   if(!el||reduced)return Promise.resolve();
   const a=el.animate(frames,{duration:280,easing:'cubic-bezier(.22,.75,.2,1)',fill:'forwards'});animations.push(a);
   return a.finished.catch(()=>{});
  };
  function cleanup(){
   cancelAnimationFrame(frame);animations.forEach(a=>a.cancel());incoming?.remove();retired.forEach(el=>el.remove());
   current.style.transform='';current.style.opacity='';current.inert=false;
   viewport.classList.remove('motion-active');viewport.removeAttribute('aria-busy');
  }
  function ensure(action,node){
   const nextKey=action.type==='move'?'move'+action.direction:action.type+action.view;
   if(node||nextKey!==key){const previous=incoming;incoming=null;key=nextKey;
    if(action.type!=='limit'){
     incoming=node||preview(action);incoming.classList.add('motion-preview');incoming.inert=true;incoming.setAttribute('aria-hidden','true');viewport.append(incoming);
     const timeline=incoming.querySelector('.timeline');if(timeline)timeline.scrollTop=7*70-20;
    }
    if(previous&&!node&&!reduced){
     // Crossing the long-swipe threshold changes the preview without a hard cut.
     retired.push(previous);
     const fade=previous.animate([{opacity:1},{opacity:0}],{duration:120,fill:'forwards'});animations.push(fade);
     fade.finished.catch(()=>{}).finally(()=>previous.remove());
     if(incoming){const appear=incoming.animate([{opacity:0},{opacity:1}],{duration:120});animations.push(appear)}
    }else previous?.remove();
   }
  }
  function paint(action){
   if(ended||reduced)return;
   ensure(action);viewport.classList.add('motion-active');
   const x=action.type==='limit'?dx*.18:Math.sign(dx)*Math.min(Math.abs(dx),width*.92);
   current.style.transform=`translate3d(${x}px,0,0)`;
   if(incoming)incoming.style.transform=`translate3d(${x+(dx<0?width:-width)}px,0,0)`;
  }
  return {
   update(value,action){
    dx=value;
    if(action.type==='view'&&lastType!=='view'&&!reduced)haptic();lastType=action.type;
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>paint(action));
   },
   async cancel(){
    if(ended)return;ended=true;cancelAnimationFrame(frame);current.inert=true;
    try{await Promise.all([animate(current,[{transform:current.style.transform||'none'},{transform:'translate3d(0,0,0)'}]),animate(incoming,[{transform:incoming?.style.transform||'none'},{transform:`translate3d(${dx<0?width:-width}px,0,0)`}])])}finally{cleanup()}
   },
   async finish(action,node,commit,ready=Promise.resolve()){
    if(ended)return;ended=true;cancelAnimationFrame(frame);ensure(action,node);current.inert=true;viewport.classList.add('motion-active');viewport.setAttribute('aria-busy','true');
    const direction=action.type==='move'?action.direction:VIEWS.indexOf(action.view)>VIEWS.indexOf(current.dataset.view)?1:-1;
    const start=current.style.transform||'translate3d(0,0,0)';
    incoming.style.transform=`translate3d(${dx+(direction*width)}px,0,0)`;
    try{
     const effects=[animate(current,[{transform:start,opacity:1},{transform:`translate3d(${-direction*width}px,0,0)`,opacity:action.type==='view'?0:1}]),animate(incoming,[{transform:incoming.style.transform,opacity:action.type==='view'?.4:1},{transform:'translate3d(0,0,0)',opacity:1}])];
     if(action.type==='view'){
      // The outgoing grid folds into a strip; the incoming content unfolds from its top edge.
      const oldContent=current.querySelector('.month,.week-strip,.timeline,.day-checklist'),newContent=incoming.querySelector('.month,.week-strip,.timeline,.day-checklist');
      const shrinking=direction>0;
      effects.push(animate(oldContent,[{transform:'scaleY(1)',opacity:1},{transform:`scaleY(${shrinking?.22:1.12})`,opacity:0}]),animate(newContent,[{transform:`scaleY(${shrinking?1.12:.3})`,opacity:.2},{transform:'scaleY(1)',opacity:1}]));
     }
     await Promise.all([...effects,ready]);commit();
    }catch(error){
     // Restore the original page smoothly if saving the view preference fails.
     const oldStyle=getComputedStyle(current),newStyle=getComputedStyle(incoming);
     const fromOld={transform:oldStyle.transform,opacity:oldStyle.opacity},fromNew={transform:newStyle.transform,opacity:newStyle.opacity};
     animations.forEach(a=>a.cancel());
     await Promise.all([animate(current,[fromOld,{transform:'translate3d(0,0,0)',opacity:1}]),animate(incoming,[fromNew,{transform:`translate3d(${direction*width}px,0,0)`,opacity:0}])]);
     throw error;
    }finally{cleanup()}
   }
  };
 }
 function mount({enabled,getView,label,run,onError,startMotion=()=>null}){
  let drag=null,hint=null,suppressUntil=0,settling=false;
  const clear=()=>{hint?.remove();hint=null;drag=null};
  const rollback=session=>{if(!session)return;settling=true;Promise.resolve(session.cancel()).catch(onError).finally(()=>settling=false)};
  const cancel=()=>{const session=drag?.motion;clear();rollback(session)};
  document.addEventListener('pointerdown',e=>{
   if(drag){cancel();return}if(settling)return;
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
    drag.axis='x';drag.motion=startMotion();drag.surface.setPointerCapture(e.pointerId);
   }
   e.preventDefault();
   const action=gesture(dx,dy,drag.width,drag.view);
   drag.motion?.update(dx,action||{type:'move',direction:dx<0?1:-1});
   if(!action){hint?.remove();hint=null;return}
   if(!hint){hint=document.createElement('div');hint.className='calendar-swipe-hint';hint.setAttribute('role','status');document.body.append(hint)}
   hint.textContent=label(action);hint.dataset.mode=action.type;
  },{passive:false});
  document.addEventListener('pointerup',e=>{
   if(!drag||e.pointerId!==drag.id)return;
   const action=drag.axis==='x'?gesture(e.clientX-drag.x,e.clientY-drag.y,drag.width,drag.view):null;
   const session=drag.motion;
   if(drag.axis==='x')suppressUntil=Date.now()+500;
   clear();
   if(action&&action.type!=='limit'&&enabled()){
    settling=true;Promise.resolve().then(()=>run(action,session)).catch(async error=>{await session?.cancel();onError(error)}).finally(()=>settling=false);
   }else rollback(session);
  });
  document.addEventListener('pointercancel',cancel);
  document.addEventListener('click',e=>{
   if(Date.now()<suppressUntil&&e.detail>0){e.preventDefault();e.stopImmediatePropagation()}
  },true);
  window.addEventListener('blur',cancel);
  return {active:()=>Boolean(drag)||settling,cancel};
 }
 const api={shift,weekHeading,gesture,motion,mount};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CalendarNavigation=api;
})(globalThis);
