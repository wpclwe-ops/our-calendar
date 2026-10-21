// Approved calendar layouts on synthetic data only; never connects to production.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync,mkdirSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-design-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'archive-key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'archive-public-keys.json'),PORT:'8004'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
 await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
 await page.clock.install({time:new Date('2026-10-17T12:00:00Z')});await page.goto('http://127.0.0.1:8004');await page.waitForSelector('.timeline');
 const wait=()=>page.waitForFunction(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active()&&!monthLoading);
 const screenshot=async name=>{if(process.env.CALENDAR_SCREENSHOT_DIR){mkdirSync(process.env.CALENDAR_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,name+'.png')})}};
 await page.evaluate(async()=>{state=await api('settings','PATCH',{theme:'dark',day_layout:'list'});for(const e of new Map((await api('events?start=2026-10-01&end=2026-11-01')).map(e=>[e.id,e])).values())await api('events/'+e.id,'DELETE',{revision:e.revision,confirmed:true});const c=await api('categories','POST',{name:'Calendar design',color:'#9B77D1'});for(let i=0;i<7;i++)await api('events','POST',{title:i===0?'Выставка «Цвет и свет»':'Задача '+(i+1),start:`2026-10-17T${String(10+i).padStart(2,'0')}:00`,end:`2026-10-17T${String(10+i).padStart(2,'0')}:30`,timezone:'Europe/Warsaw',category_id:c.id,owner:'both',location:i===0?'Wrocław':''});await loadData();render()});await wait();
 assert.equal(await page.locator('.month-title').textContent(),'17 октября');assert.equal(await page.locator('.day-layout-row').count(),0);
 const toggle=page.locator('.layout-toggle');const listIcon=await toggle.innerHTML();assert.equal(await toggle.getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('.day-task [data-action=delete-day-event]').count(),0);assert.equal(await page.locator('.day-task .task-delete').count(),0);await screenshot('day-list-dark');await toggle.click();await wait();assert.equal(await toggle.innerHTML(),listIcon);assert.equal(await toggle.getAttribute('aria-pressed'),'false');
 await toggle.click();await wait();
 await page.locator('.day-checklist').evaluate(el=>el.scrollTop=el.scrollHeight);
 assert.ok(await page.locator('.day-task').last().evaluate(el=>{const a=el.getBoundingClientRect(),b=document.querySelector('.calendar-actions').getBoundingClientRect();return a.bottom<=b.top}),'last task can scroll clear of floating controls');
 await toggle.click();await wait();
 assert.equal(await page.locator('.time-event').first().evaluate(el=>getComputedStyle(el).borderLeftWidth),'0px');
  assert.equal(await page.locator('.time-event .time-place').count(),0);
  const firstTimeline=page.locator('.time-event').first();
  assert.equal(await firstTimeline.locator('.time-event-title').textContent(),'Выставка «Цвет и свет»');
  assert.equal(await firstTimeline.locator('.time-owner').textContent(),'Обоим');
  assert.match(await firstTimeline.locator('.time-range').textContent(),/10:00.*10:30/);
  assert.equal(await firstTimeline.locator('.time-range').evaluate(el=>getComputedStyle(el).display),'block');
  assert.ok(await firstTimeline.evaluate(el=>{const a=el.querySelector('.time-event-title').getBoundingClientRect(),b=el.querySelector('.time-owner').getBoundingClientRect(),c=el.querySelector('.time-range').getBoundingClientRect();return b.left>=a.left&&c.top>=a.top+a.height-1}));
  assert.equal(await page.locator('.time-event.short-event').first().evaluate(el=>getComputedStyle(el).borderRadius),'6px');
 for(const block of await page.locator('.time-event').all())assert.ok(Math.abs(Number(await block.getAttribute('data-height'))-35)<.01);
 const actions=page.locator('.calendar-actions'),fab=page.locator('.calendar-actions .fab'),today=page.locator('.calendar-actions .today-btn');
  assert.equal(await actions.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  for(const item of [fab,today]){assert.equal(await item.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');assert.equal(await item.evaluate(el=>getComputedStyle(el).backgroundColor),await page.locator('.calendar-tools .icon').first().evaluate(el=>getComputedStyle(el,'::before').backgroundColor))}
  assert.ok(await fab.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.querySelector('svg').getBoundingClientRect();return Math.abs((b.left+b.width/2)-(a.left+a.width/2))<1&&Math.abs((b.top+b.height/2)-(a.top+a.height/2))<1}));
  assert.equal(await page.locator('.calendar-motion-viewport').evaluate(el=>getComputedStyle(el).marginBottom),'0px');
  await page.locator('.timeline').evaluate(el=>el.scrollTop=9*70);await screenshot('day-timeline-dark');
 // Separate filter menu, combined owner/category/status filtering, Cancel, and reset.
 await page.locator('[data-action=filters]').click();await page.waitForSelector('.filter-sheet');assert.equal(await page.locator('.filter-sheet select').count(),3);
 await page.locator('.filter-sheet [name=filter-status]').selectOption('done');await page.locator('.filter-sheet [data-close]').click();assert.equal(await page.evaluate(()=>filter.status),'');
 await page.locator('[data-action=filters]').click();await page.locator('.filter-sheet [name=filter-status]').selectOption('done');await page.locator('.filter-sheet [type=submit]').click();await wait();assert.equal(await page.locator('.time-event').count(),0);
 await page.locator('[data-action=filters]').click();await page.locator('.filter-sheet [data-reset]').click();await page.locator('.filter-sheet [type=submit]').click();await wait();
 await page.evaluate(async()=>{selected='2026-10-17';await changeView('month')});await wait();
 assert.equal(await page.locator('.month-with-agenda .day').count(),35);assert.equal(await page.locator('.month-agenda .day-task').count(),7);
 const monthBox=await page.locator('.month').boundingBox();
 await page.locator('.month-with-agenda').evaluate(el=>el.scrollTop=200);
 const monthScrollTop=await page.locator('.month-with-agenda').evaluate(el=>el.scrollTop);
 assert.ok(monthScrollTop>0,'whole month scrolls, not just tasks');
 assert.ok((await page.locator('.month').boundingBox()).y<monthBox.y-10,'calendar moves up with tasks');
 assert.equal(await page.locator('.month-agenda').evaluate(el=>el.scrollTop),0,'task list has no independent scrollport');
 await page.evaluate(()=>render());assert.ok(Math.abs((await page.locator('.month-with-agenda').evaluate(el=>el.scrollTop))-monthScrollTop)<2,'preserve unified scroll on repaint');
 await page.locator('[data-action=today]').click();await wait();
 assert.equal(await page.locator('.month-with-agenda').evaluate(el=>el.scrollTop),0,'Today reveals the calendar even when today is already selected');
 await page.locator('.day[data-date="2026-10-18"]').click();await wait();assert.equal(await page.evaluate(()=>view),'month');assert.equal(await page.locator('.month-agenda .day-task').count(),0);
 await page.locator('[data-action=today]').click();await wait();await page.locator('.month-with-agenda').evaluate(el=>el.scrollTop=0);await screenshot('month-full-dark');
 await page.locator('[data-action=month-layout]').click();await wait();assert.equal(await page.locator('.month-agenda').count(),0);
 assert.equal(await page.locator('.month-scroll .day[data-date="2026-10-17"] .event-bar').count(),5);assert.equal(await page.locator('.month-scroll .day[data-date="2026-10-17"] .more').textContent(),'+2');
 const dates=await page.locator('.month-scroll .day').evaluateAll(els=>els.map(el=>el.dataset.date));assert.equal(new Set(dates).size,dates.length);
 for(const height of [568,667]){
  await page.setViewportSize({width:320,height});await page.waitForTimeout(100);
  assert.ok(await page.locator('.month-scroll .day[data-date="2026-10-17"]').evaluate(el=>{const cell=el.getBoundingClientRect(),last=el.querySelector('.more').getBoundingClientRect();return last.bottom<=cell.bottom&&last.height>0}),'five tasks and overflow remain reachable in a short WebView: '+height);
  await screenshot('month-scroll-short-'+height);
 }
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});await page.waitForTimeout(80);assert.ok(await page.locator('.month-scroll').evaluate(el=>el.querySelector('.scroll-week').offsetHeight>=Math.max(260,Math.round(el.clientHeight/2))));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const fit=await page.locator('.month-scroll .day[data-date="2026-10-17"]').evaluate(el=>{const chip=el.querySelectorAll('.event-bar')[4],last=el.querySelector('.more'),cell=el.getBoundingClientRect();return {ok:chip.getBoundingClientRect().bottom<=cell.bottom&&last.getBoundingClientRect().bottom<=cell.bottom,cell:cell.height,chip:Math.round(chip.getBoundingClientRect().bottom-cell.top),more:Math.round(last.getBoundingClientRect().bottom-cell.top),scroll:el.closest('.month-scroll').clientHeight,width:innerWidth}});assert.ok(fit.ok,'five tasks and overflow fit within date: '+JSON.stringify(fit));await screenshot('month-scroll-dark-'+width)}
 // Both month layouts must paint behind the floating actions, including while scrolling.
 for(const theme of ['light','dark'])for(const width of [320,390,430])for(const layout of ['paged','scroll']){
  await page.setViewportSize({width,height:width===320?568:844});
  await page.evaluate(async({theme,layout})=>{state.me.theme=theme;state.me.month_layout=layout;selected='2026-10-17';monthWindow=[];await loadData();render()},{theme,layout});await wait();
  const selector=layout==='paged'?'.month-with-agenda':'.month-scroll';
  await page.locator(selector).evaluate(el=>el.scrollTop+=70);await page.waitForTimeout(140);await wait();
  const band=await page.locator(selector).evaluate(el=>{
   const box=el.getBoundingClientRect(),actions=document.querySelector('.calendar-actions'),a=actions.getBoundingClientRect();
   const hit=document.elementFromPoint(a.x+a.width/2,a.y+a.height/2);
   return {bottom:box.bottom,height:innerHeight,transparent:getComputedStyle(actions).backgroundColor,touchable:Boolean(hit?.closest('.month-with-agenda,.month-scroll'))};
  });
  assert.ok(Math.abs(band.bottom-band.height)<2,layout+' extends to screen bottom: '+JSON.stringify(band));
  assert.equal(band.transparent,'rgba(0, 0, 0, 0)');assert.equal(band.touchable,true,layout+' gap between actions passes to calendar');
  if(layout==='paged'){
   await page.locator(selector).evaluate(el=>el.scrollTop=el.scrollHeight);
   const last=await page.locator('.month-agenda .day-task').last().boundingBox(),actions=await page.locator('.calendar-actions').boundingBox();
   assert.ok(last.y+last.height<=actions.y,'last month task scrolls above actions');
  }else{
   const before=await page.locator(selector).evaluate(el=>monthAnchor(el));await page.evaluate(()=>render());
   const after=await page.locator(selector).evaluate(el=>monthAnchor(el));assert.equal(after.week,before.week);assert.ok(Math.abs(after.offset-before.offset)<2);
   // Dense weeks keep readable cards; scroll the overflow control itself above the floating actions.
   await page.locator('.month-scroll .day[data-date="2026-10-17"] .more').evaluate(el=>el.scrollIntoView({block:'center'}));
   const more=await page.locator('.month-scroll .day[data-date="2026-10-17"] .more').boundingBox(),actions=await page.locator('.calendar-actions').boundingBox();
   assert.ok(more.y+more.height<=actions.y,'month overflow button can scroll above actions');
  }
  await screenshot('month-no-band-'+layout+'-'+theme+'-'+width);
 }
 await page.locator('.month-scroll .day[data-date="2026-10-17"] .more').click();await wait();assert.equal(await page.locator('.month-agenda .day-task').count(),7);
 await page.locator('.month-agenda [data-action=event]').first().click();await page.waitForSelector('.detail-title');assert.ok((await page.locator('.detail-title').textContent()).length>0);
  assert.equal(await page.locator('.detail-actions button').count(),2);
  await page.locator('.detail-badges [data-action=status-options]').click();await page.locator('.event-status-picker [data-status=cancelled]').click();await wait();
  assert.equal(await page.evaluate(()=>currentEvent.status),'cancelled');
  await page.locator('[data-action=edit-event].header-save').click();await page.waitForSelector('#event-form');
  assert.equal(await page.locator('.advanced-section').count(),0);
  assert.ok(await page.locator('.title-field input').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=24));
  assert.equal(await page.locator('.event-reminders select[data-reminder-preset]').count(),2,'legacy start notification is explicitly editable');
  await page.locator('[data-action=back]').first().click();await page.waitForSelector('.detail-title');
 await page.locator('[data-action=back]').first().click();await wait();
 await page.evaluate(async()=>{selected='2026-10-17';await changeView('week')});await wait();assert.equal(await page.locator('[data-action=week-layout]').count(),1);assert.equal(await page.locator('.week-date').count(),7);await screenshot('week-dark');
 await page.evaluate(()=>{state.me.theme='light';render()});await screenshot('week-light');
  await page.locator('.bottom-nav [data-tab=settings]').click();await wait();
  assert.deepEqual(await page.locator('.settings-menu [data-action=settings-open]').evaluateAll(nodes=>nodes.map(n=>n.dataset.section)),['pair','appearance','language','views','events','connections','data','service','advanced']);
  await page.locator('[data-section=appearance]').click();await wait();
  assert.equal(await page.locator('[data-action=touchbar] .svg-icon').count(),1,'Bottom bar setting only has a chevron');
  await page.locator('[data-action=settings-back]').click();await page.locator('[data-section=events]').click();await wait();
  await page.locator('[data-action=settings-categories]').click();await wait();
  assert.equal(await page.locator('[data-action=back-to-settings]').count(),1);
  await page.locator('[data-action=back-to-settings]').click();await wait();assert.equal(await page.evaluate(()=>tab),'settings');
 // Defaults are a two-choice menu; event reminders retain their compact editor.
 await page.locator('[data-action=settings-default-notifications]').click();
 for(const value of await page.locator('[data-notification-choices] input:checked').evaluateAll(nodes=>nodes.map(n=>n.value)))await page.locator(`[data-notification-choices] input[value="${value}"]`).uncheck();
 await page.locator('.modal details summary').click();await page.locator('[data-add-custom]').click();
 await page.locator('.modal button[type=submit]').click();await page.waitForFunction(()=>state.me.default_notifications.includes(45));
 assert.deepEqual(await page.evaluate(()=>state.me.default_notifications),[45]);
 await screenshot('settings-native-reminders');
 await page.locator('[data-action=settings-back]').click();await wait();
 await page.locator('.bottom-nav [data-view=day]').click();await wait();
 await page.evaluate(async()=>{selected='2026-10-09';await loadData();render()});
 assert.equal(await page.locator('.month-title').textContent(),'9 октября');
 assert.equal(await page.locator('.calendar-heading .day-weekday').textContent(),'пятница');
 assert.equal((await page.locator('.calendar-heading').textContent()).match(/9 октября/g).length,1);
 await page.locator('[data-action=new]').click();await page.waitForSelector('#event-form');
 assert.equal(await page.locator('.advanced-section').count(),0);
 assert.ok(await page.locator('[name=location]').isVisible());
 assert.ok(await page.locator('.event-reminders').evaluate(el=>{const repeat=document.querySelector('[name=repeat]').closest('.form-row');return repeat.nextElementSibling===el}),'reminder directly follows repetition');
 await page.locator('[name=title]').fill('Произвольное напоминание');
 let eventReminders=page.locator('[data-reminder-editor=event]');
 await eventReminders.locator('[data-reminder-amount]').fill('7');
 await eventReminders.locator('[data-reminder-unit]').selectOption('1440');
 assert.deepEqual(await page.evaluate(()=>formEvent.reminders[state.me.id]),[10080]);
 assert.equal(await page.inputValue('[name=title]'),'Произвольное напоминание');
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.locator('.all-day-switch').evaluate(row=>{const input=row.querySelector('input'),a=input.getBoundingClientRect(),b=row.getBoundingClientRect();return a.width===46&&a.height===28&&Math.abs(a.y+a.height/2-b.y-b.height/2)<2}));
  assert.equal(await page.locator('[name=start]').evaluate(el=>getComputedStyle(el).textAlign),'center');
  await screenshot('event-native-reminders-'+width);
 }
 await page.locator('[name=all_day]').check();await wait();
 assert.equal(await page.locator('[name=start]').getAttribute('type'),'date');
 assert.equal(await page.inputValue('[name=title]'),'Произвольное напоминание');
 assert.deepEqual(await page.evaluate(()=>formEvent.reminders[state.me.id]),[10080]);
 await page.locator('[name=all_day]').uncheck();await wait();
 await page.locator('[type=submit][form=event-form]').click();await page.waitForSelector('.detail-title');
 assert.deepEqual(await page.evaluate(()=>currentEvent.reminders[state.me.id]),[10080]);
 assert.deepEqual(await page.evaluate(()=>currentEvent.reminders['2']),[60]);
 // Reminder editing is a separate cancellable sheet and sends no event fields.
 assert.doesNotMatch(await page.locator('.detail-reminders').textContent(),/Только ваши настройки|У партнёра/);
 assert.ok(await page.locator('.status-chip').evaluate(el=>{const a=el.querySelector('svg').getBoundingClientRect(),b=el.querySelector('span').getBoundingClientRect();return Math.abs(a.y+a.height/2-b.y-b.height/2)<1}),'status chevron is vertically centered');
 const beforeReminder=await page.evaluate(()=>structuredClone(currentEvent)),reminderRequests=[];
 const endpoint='http://127.0.0.1:8004/api/events/'+beforeReminder.id;
 page.on('request',r=>{if(r.url()===endpoint&&r.method()==='PATCH')reminderRequests.push(r.postDataJSON())});
 await page.locator('[data-action=edit-reminders]').click();await page.waitForSelector('.event-reminder-sheet');
 assert.equal(await page.locator('#event-form,[name=title]').count(),0);
 let sheet=page.locator('.event-reminder-sheet');
 await sheet.locator('[data-reminder-preset]').selectOption('120');
 await sheet.locator('.reminder-sheet-actions [data-close]').click();
 assert.equal(reminderRequests.length,0);assert.deepEqual(await page.evaluate(()=>currentEvent.reminders[state.me.id]),[10080]);
 await page.locator('[data-action=edit-reminders]').click();
 await sheet.locator('[data-reminder-preset]').selectOption('120');
 await sheet.locator('[data-action=add-reminder]').click();await sheet.locator('[data-action=add-reminder]').click();
 assert.equal(await sheet.locator('[data-reminder-preset]').count(),3);
 assert.equal(await sheet.locator('[data-action=add-reminder]').count(),0);
 await screenshot('reminder-only-sheet');
 await page.route(endpoint,r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"error"}'}));
 await sheet.locator('[type=submit]').click();await page.waitForFunction(()=>!!document.querySelector('.reminder-sheet-error')?.textContent);await wait();
 assert.ok(await sheet.isVisible());assert.deepEqual(await page.evaluate(()=>currentEvent.reminders[state.me.id]),[10080]);
 await page.unroute(endpoint);await sheet.locator('[type=submit]').click();await page.waitForSelector('.reminder-backdrop',{state:'hidden'});await wait();
 assert.deepEqual(Object.keys(reminderRequests.at(-1)).sort(),['reminders','reminders_v2','revision']);
 assert.deepEqual(await page.evaluate(()=>currentEvent.reminders[state.me.id]),[120,30,15]);
 assert.deepEqual(await page.evaluate(()=>currentEvent.reminders['2']),[60]);
 for(const field of ['title','start','end','timezone','owner','category_id','status','description'])assert.deepEqual(await page.evaluate(field=>currentEvent[field],field),beforeReminder[field]);
 // For a series, editing the displayed event changes only that occurrence.
 const series=await page.evaluate(async()=>{const e=await api('events','POST',{title:'Reminder series',start:'2026-10-17T12:00',end:'2026-10-17T13:00',timezone:'Europe/Warsaw',rrule:'FREQ=DAILY;COUNT=2'});await openEvent(e.id,'2026-10-18T12:00');return e.id});
 await page.locator('[data-action=edit-reminders]').click();await sheet.locator('[data-reminder-preset]').selectOption('120');await sheet.locator('[type=submit]').click();await page.waitForSelector('.reminder-backdrop',{state:'hidden'});await wait();
 const result=await page.evaluate(id=>api('events/'+id+'?occurrence=2026-10-18T12:00'),series);
 assert.deepEqual(result.reminders['1'],[45]);assert.deepEqual(result.selected_instance.reminders['1'],[120]);assert.deepEqual(result.selected_instance.reminders['2'],[60]);
 await page.locator('[data-action=back]').first().click();await wait();
 await page.reload();await page.waitForSelector('.timeline');assert.equal(await page.evaluate(()=>state.me.day_layout),'timeline');assert.equal(await page.evaluate(()=>state.me.month_layout),'paged');
 assert.deepEqual(errors,[]);console.log('PASS: compact timeline time/owner, gray centered actions, unified month-and-agenda scrolling, settings hierarchy, status dialog and two distinct month modes.');
 }finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});

