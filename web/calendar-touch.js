/* Long press and timed-event dragging, separate from horizontal navigation. */
(function(root){
 'use strict';
 function mount({enabled,getEvent,onCreate,onMove,onError,cancelSwipe,haptic}){
  let press=null,suppressed=0;
  const cleanup=()=>{
   if(!press)return;
   clearTimeout(press.timer);cancelAnimationFrame(press.frame);
   press.node?.classList.remove('event-dragging');press.badge?.remove();
   if(press.node&&press.top!==undefined)press.node.style.top=press.top+'px';
   document.body.classList.remove('calendar-holding');press=null;
  };
  const minuteAt=(timeline,y)=>Math.max(0,Math.min(1435,Math.round((y-timeline.getBoundingClientRect().top+timeline.scrollTop)/70*60/5)*5));
  function paint(){
   if(!press?.held||!press.event)return;
   const p=press,box=p.timeline.getBoundingClientRect();
   if(p.y<box.top+45)p.timeline.scrollTop-=7;
   if(p.y>box.bottom-45)p.timeline.scrollTop+=7;
   p.minute=minuteAt(p.timeline,p.y-p.offset);
   p.node.style.top=p.minute/60*70+'px';
   const hours=String(Math.floor(p.minute/60)).padStart(2,'0'),minutes=String(p.minute%60).padStart(2,'0');
   p.badge.textContent=hours+':'+minutes;p.badge.style.top=Math.max(box.top,Math.min(box.bottom-34,p.y-42))+'px';
   p.frame=requestAnimationFrame(paint);
  }
  document.addEventListener('pointerdown',e=>{
   if(press){cleanup();return}
   if(!e.isPrimary||e.button>0||!enabled()||e.target.closest('header,.calendar-controls,.day-layout-row,.motion-preview,.day-task,.search-page'))return;
   const eventNode=e.target.closest('.time-event'),timeline=e.target.closest('.timeline'),date=e.target.closest('.day,.week-date,.agenda,.day-checklist');
   if(!eventNode&&e.target.closest('[data-action="event"],button:not(.week-date),input,select,textarea'))return;
   if(!eventNode&&!timeline&&!date)return;
   const node=eventNode||date||timeline;
   press={day:e.target.closest('.timeline-day')?.dataset.date,id:e.pointerId,x:e.clientX,y:e.clientY,originY:e.clientY,node,timeline,date,held:false};
   if(eventNode){
    try{press.event=getEvent(eventNode)}catch(error){cleanup();onError(error);return}
    press.top=Number(eventNode.dataset.top);press.offset=e.clientY-eventNode.getBoundingClientRect().top;
    // A continuation on a later day moves by its delta, preserving the original start date.
    press.startMinute=minuteAt(timeline,e.clientY-press.offset);
   }
   press.timer=setTimeout(()=>{
    if(!press||!enabled())return cleanup();
    press.held=true;suppressed=Date.now()+800;cancelSwipe();haptic();
    if(press.event){
     press.node.classList.add('event-dragging');document.body.classList.add('calendar-holding');
     press.node.setPointerCapture(press.id);press.badge=document.createElement('div');press.badge.className='drag-time-badge';document.body.append(press.badge);paint();
    }
   },480);
  });
  document.addEventListener('pointermove',e=>{
   if(!press||press.id!==e.pointerId)return;
   if(!press.held){if(Math.hypot(e.clientX-press.x,e.clientY-press.originY)>9)cleanup();return}
   press.y=e.clientY;e.preventDefault();
  },{passive:false});
  // iOS only honours preventDefault from touchmove listeners registered before the gesture starts, so this one is registered up front and only acts once the hold is armed.
  document.addEventListener('touchmove',e=>{if(press?.held&&e.cancelable)e.preventDefault()},{passive:false});
  document.addEventListener('pointerup',e=>{
   if(!press||press.id!==e.pointerId)return;
   const p=press;
   if(p.held){
    suppressed=Date.now()+650;e.preventDefault();
    const day=p.day||p.date?.dataset.date||p.timeline?.dataset.date,minute=p.timeline?minuteAt(p.timeline,p.originY):undefined;
    cleanup();
    Promise.resolve().then(()=>p.event?(p.minute!==p.startMinute?onMove(p.event,p.minute,p.startMinute,p.day):undefined):onCreate(day,minute)).catch(onError);
   }else cleanup();
  });
  document.addEventListener('pointercancel',cleanup);window.addEventListener('blur',cleanup);
  document.addEventListener('contextmenu',e=>{if(press){e.preventDefault()}});
  document.addEventListener('click',e=>{if(Date.now()<suppressed){e.preventDefault();e.stopImmediatePropagation()}},true);
  return {active:()=>Boolean(press),cancel:cleanup};
 }
 // Hold first, then swipe a list card. Ordinary swipes still belong to navigation.
 function mountList({enabled,onAction,onError,cancelSwipe,haptic,label}){
  let press=null,suppressed=0;
  const cleanup=()=>{
   const p=press;if(!p)return;press=null;clearTimeout(p.timer);
   p.row.style.transform='';p.row.classList.remove('list-swipe-armed','list-swipe-ready');
   p.badge?.remove();document.body.classList.remove('list-holding');
   if(p.node.hasPointerCapture(p.id))p.node.releasePointerCapture(p.id);
  };
  const actionAt=(dx,dy)=>Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy)*1.5?(dx<0?'delete':'edit'):null;
  document.addEventListener('pointerdown',e=>{
   if(press){cleanup();return}
   if(!e.isPrimary||e.button>0||!enabled()||e.target.closest('.motion-preview,.modal-backdrop'))return;
   if(e.target.closest('.task-actions'))return;
   const node=e.target.closest('.day-task')?.querySelector('.day-task-card')||e.target.closest('.search-page .event');if(!node)return;
   const row=node.closest('.day-task')||node;
   press={id:e.pointerId,x:e.clientX,y:e.clientY,node,row,held:false};
   press.timer=setTimeout(()=>{
    if(!press||!enabled()||!node.isConnected)return cleanup();
    press.held=true;suppressed=Date.now()+650;cancelSwipe();haptic();
    node.setPointerCapture(press.id);row.classList.add('list-swipe-armed');document.body.classList.add('list-holding');
    press.badge=document.createElement('div');press.badge.className='list-swipe-hint';press.badge.setAttribute('role','status');
    press.badge.textContent=label('hold');
    const box=row.getBoundingClientRect();press.badge.style.top=Math.max(8,Math.min(innerHeight-48,box.top-38))+'px';
    document.body.append(press.badge);
   },400);
  });
  document.addEventListener('pointermove',e=>{
   if(!press||press.id!==e.pointerId)return;
   const dx=e.clientX-press.x,dy=e.clientY-press.y;
   if(!press.held){if(Math.hypot(dx,dy)>9)cleanup();return}
   if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){cleanup();return}
   e.preventDefault();
   const action=actionAt(dx,dy);press.row.style.transform=`translate3d(${Math.max(-88,Math.min(88,dx))}px,0,0)`;
   press.row.classList.toggle('list-swipe-ready',Boolean(action));
   press.badge.textContent=label(Math.abs(dx)<12?'hold':dx<0?'delete':'edit');
   press.badge.dataset.action=dx<0?'delete':'edit';
  },{passive:false});
  document.addEventListener('touchmove',e=>{if(press?.held&&e.cancelable)e.preventDefault()},{passive:false});
  document.addEventListener('pointerup',e=>{
   if(!press||press.id!==e.pointerId)return;
   const p=press,action=p.held?actionAt(e.clientX-p.x,e.clientY-p.y):null;
   if(p.held){suppressed=Date.now()+650;e.preventDefault()}
   cleanup();
   if(action&&enabled()&&p.node.isConnected)Promise.resolve().then(()=>onAction(p.node,action)).catch(onError);
  });
  document.addEventListener('pointercancel',cleanup);document.addEventListener('lostpointercapture',e=>{if(e.pointerId===press?.id)cleanup()});
  document.addEventListener('scroll',cleanup,true);window.addEventListener('blur',cleanup);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cleanup()});
  document.addEventListener('contextmenu',e=>{if(press)e.preventDefault()});
  document.addEventListener('click',e=>{if(Date.now()<suppressed){e.preventDefault();e.stopImmediatePropagation()}},true);
  return {active:()=>Boolean(press),cancel:cleanup};
 }
 root.CalendarTouch={mount,mountList};
})(globalThis);
