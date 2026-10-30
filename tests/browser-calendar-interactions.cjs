// Integration checks on a temporary synthetic database; no production access.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-interactions-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'archive-key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'archive-public-keys.json'),PORT:'8001'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
 await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
 await page.clock.install({time:new Date('2026-10-16T20:30:00Z')});await page.goto('http://127.0.0.1:8001');
 await page.waitForSelector('.timeline');const cdp=await context.newCDPSession(page);
 const wait=async()=>{await page.waitForFunction(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active()&&!monthLoading);await page.waitForTimeout(30)};
 const set=async(date,mode)=>{await page.evaluate(async({date,mode})=>{selected=date;await changeView(mode)},{date,mode});await wait()};
 async function hold(x,y,endY=y){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await page.waitForTimeout(540);
  if(endY!==y){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:endY}]});await page.waitForTimeout(80)}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait();await page.waitForTimeout(700);
 }
 const back=async()=>{await page.locator('[data-action="back"]').first().click();await wait()};
 assert.equal(await page.evaluate(()=>view),'day');
 assert.deepEqual(await page.locator('.bottom-nav button').allTextContents(),['День','Месяц','Настройки']);
 assert.equal(await page.locator('.calendar-view-row').count(),0);
 assert.equal(await page.locator('.now-line').getAttribute('data-time'),'22:30');
 const line=await page.locator('.now-line').boundingBox(),viewport=await page.locator('.timeline').boundingBox();assert.ok(line.y>=viewport.y&&line.y<=viewport.y+viewport.height);
 await page.locator('.timeline').evaluate(el=>el.scrollTop=300);await page.evaluate(()=>render());assert.equal(await page.locator('.timeline').evaluate(el=>el.scrollTop),300);
 // New defaults and end tracking across midnight, plus explicit end preservation.
 await page.locator('[data-action="new"]').click();await wait();
 assert.equal(await page.inputValue('[name="start"]'),'2026-10-16T22:30');assert.equal(await page.inputValue('[name="end"]'),'2026-10-16T23:30');
 const timeWheel=async(field,h,m,date)=>{
  await page.locator('[data-action=event-datetime]').click();if(field==='end')await page.locator('[data-ed-tab=end]').click();
  if(date){await page.locator('[data-ed-date-toggle]').click();await page.locator(`[data-ed-day-choice="${date}"]`).click()}
  for(const [part,n] of [['hour',h],['minute',m]]){await page.locator(`[data-ed-wheel=${part}]`).focus();await page.keyboard.press('Home');for(let i=0;i<n;i++)await page.keyboard.press('ArrowDown')}
  await page.locator('[data-ed-done]').click();await wait();
 };
 await timeWheel('start',23,30);assert.equal(await page.inputValue('[name="end"]'),'2026-10-17T00:30');
 await timeWheel('end',2,0);
 await timeWheel('start',0,0,'2026-10-17');assert.equal(await page.inputValue('[name="end"]'),'2026-10-17T02:00');await back();
 // Personal settings, Today preserves the current view, and settings survive a fresh login.
 await page.locator('[data-tab="settings"]').last().click();await wait();
 await page.locator('[data-section=views]').click();await page.locator('[data-action=settings-view][data-key=day_layout]').click();await page.locator('[data-action=settings-view-choose][data-value=list]').click();await wait();await page.locator('[data-action=settings-view][data-key=month_layout]').click();await page.locator('[data-action=settings-view-choose][data-value=scroll]').click();await wait();await page.locator('[data-action=settings-back]').click();await page.locator('[data-section=events]').click();await wait();
 await page.selectOption('[name="duration-preset"]','custom');await page.locator('[name="setting-default_duration"]').fill('95');await page.locator('[name="setting-default_duration"]').dispatchEvent('change');await wait();
 await page.locator('[data-action=settings-back]').click();await wait();
 await page.locator('.bottom-nav [data-view="day"]').click();await wait();await set('2026-11-10','week');await page.locator('[data-action="today"]').click();await wait();
 assert.equal(await page.evaluate(()=>selected),'2026-10-16');assert.equal(await page.evaluate(()=>view),'week');
 await page.locator('.bottom-nav [data-view="day"]').click();await wait();assert.equal(await page.locator('.day-checklist').count(),1);
 await page.locator('[data-action="new"]').click();await wait();assert.equal(await page.inputValue('[name="end"]'),'2026-10-17T00:05');await back();
 await page.reload();await page.waitForSelector('.day-checklist');assert.equal(await page.evaluate(()=>state.me.default_duration),95);
 // Continuous months load both ways and remain bounded without resetting the scroll anchor.
 await set('2026-10-16','month');assert.equal(await page.evaluate(()=>monthWindow.length),3);
 assert.ok(await page.locator('.month-scroll').evaluate(el=>Math.abs(el.clientHeight/2-el.querySelector('.scroll-week').offsetHeight)<2));
 const dates=await page.locator('.month-scroll .day').evaluateAll(els=>els.map(el=>el.dataset.date));assert.equal(new Set(dates).size,dates.length);
 for(let i=1;i<dates.length;i++)assert.equal(Date.parse(dates[i])-Date.parse(dates[i-1]),86400000);
 assert.ok(await page.locator('.month-scroll').evaluate(el=>el.scrollTop)>100);
 await page.locator('.month-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(400);await wait();assert.ok(await page.evaluate(()=>monthWindow.length)>=4);
 for(let i=0;i<7;i++){await page.locator('.month-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(240);await wait()}
 assert.ok(await page.evaluate(()=>monthWindow.length)<=7);
 const before=await page.evaluate(()=>monthWindow[0]);await page.locator('.month-scroll').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(400);await wait();assert.ok(await page.evaluate(()=>monthWindow[0])<before);
 if(process.env.CALENDAR_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,'scroll-month.png')});
 // Long press empty month and week dates creates an event for that date.
 await set('2026-10-16','month');
 const cell=page.locator('.day[data-date="2026-10-18"]');await cell.scrollIntoViewIfNeeded();let box=await cell.boundingBox();await hold(box.x+box.width/2,box.y+box.height-12);
 assert.equal(await page.evaluate(()=>page),'form');assert.equal((await page.inputValue('[name="start"]')).slice(0,10),'2026-10-18');await back();
 await set('2026-10-16','week');box=await page.locator('.week-date[data-date="2026-10-18"]').boundingBox();await hold(box.x+box.width/2,box.y+box.height/2);assert.equal(await page.evaluate(()=>page),'form');await back();
 // Synthetic event with an explicit category and ownership, followed by a drag.
 const ev=await page.evaluate(async()=>{const category=await api('categories','POST',{name:'Drag test',color:'#D77777'});return api('events','POST',{title:'Drag specimen',start:'2026-10-16T09:00',end:'2026-10-16T10:00',timezone:'Europe/Warsaw',owner:'both',category_id:category.id})});
 await set('2026-10-16','week');const indicator=page.locator('.week-date[data-date="2026-10-16"] .week-marker');assert.equal(await indicator.getAttribute('data-bg'),'#D77777');
 await page.evaluate(async()=>{state=await api('settings','PATCH',{day_layout:'timeline'});view='day';await loadData();render()});await wait();
 await page.locator('.timeline').evaluate(el=>el.scrollTop=8*70);
 assert.equal(await page.locator(`.time-event[data-id="${ev.id}"] .time-owner`).textContent(),'Обоим');
 box=await page.locator(`.time-event[data-id="${ev.id}"]`).boundingBox();await hold(box.x+box.width/2,box.y+12,box.y+82);
 const moved=await page.evaluate(id=>api('events/'+id),ev.id);assert.equal(moved.start,'2026-10-16T10:00');assert.equal(moved.end,'2026-10-16T11:00');
 // Empty timeline long press uses the touched time, without opening an existing event.
 const tl=await page.locator('.timeline').boundingBox();await hold(tl.x+90,tl.y+35);assert.equal(await page.evaluate(()=>page),'form');assert.notEqual(await page.inputValue('[name="start"]'),'2026-10-16T22:30');await back();
 // A short vertical touch cancels creation; it does not leave a hold pending.
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:80,y:450}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:80,y:400}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait();assert.equal(await page.evaluate(()=>page),'main');
 // A failed save rolls back the visual position and leaves server times unchanged.
 await page.locator('.timeline').evaluate(el=>el.scrollTop=9*70);
 await page.route('**/api/events/'+ev.id,route=>route.request().method()==='PATCH'?route.fulfill({status:409,contentType:'application/json',body:'{"error":"revision_conflict"}'}):route.continue());
 box=await page.locator(`.time-event[data-id="${ev.id}"]`).boundingBox();await hold(box.x+box.width/2,box.y+12,box.y+82);
 await page.unroute('**/api/events/'+ev.id);assert.equal((await page.evaluate(id=>api('events/'+id),ev.id)).start,'2026-10-16T10:00');
 // Query links open exactly the requested event and occurrence after authentication.
 await page.goto('http://127.0.0.1:8001/?event='+ev.id);await page.waitForSelector('.detail-title');assert.equal(await page.locator('.detail-title').textContent(),'Drag specimen');
 assert.equal(await page.evaluate(()=>selected),'2026-10-16');
 await back();await page.evaluate(id=>{history.pushState(null,'','?event='+id);window.dispatchEvent(new Event('focus'))},ev.id);await page.waitForSelector('.detail-title');assert.equal(await page.locator('.detail-title').textContent(),'Drag specimen');
 const series=await page.evaluate(()=>api('events','POST',{title:'Linked series',start:'2026-10-16T15:00',end:'2026-10-16T16:00',timezone:'Europe/Warsaw',rrule:'FREQ=DAILY;COUNT=3'}));
 await page.goto('http://127.0.0.1:8001/?event='+series.id+'&occurrence=2026-10-18T15%3A00');await page.waitForSelector('.detail-title');assert.equal(await page.evaluate(()=>currentEvent.occurrence),'2026-10-18T15:00');assert.equal(await page.evaluate(()=>selected),'2026-10-18');
 // Dragging just one occurrence leaves its master and neighbouring dates unchanged.
 await back();await set('2026-10-18','day');await page.evaluate(async()=>{state=await api('settings','PATCH',{day_layout:'timeline'});await loadData();render()});await wait();
 await page.locator('.timeline').evaluate(el=>el.scrollTop=14*70);box=await page.locator(`.time-event[data-id="${series.id}"]`).boundingBox();await hold(box.x+box.width/2,box.y+12,box.y+82);
 await page.locator('[data-choice="one"]').click();await wait();const changed=await page.evaluate(id=>api('events/'+id+'?occurrence=2026-10-18T15%3A00'),series.id);
 assert.equal(changed.start,'2026-10-16T15:00');assert.equal(changed.selected_instance.start,'2026-10-18T16:00');
 await page.goto('http://127.0.0.1:8001/?event=missing');await page.waitForSelector('.calendar-controls');await page.waitForTimeout(200);assert.match(await page.locator('#toast').textContent(),/удалено|недоступно/);
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
 await page.evaluate(()=>{state.me.theme='dark';render()});if(process.env.CALENDAR_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,'timeline-dark.png')});
 assert.deepEqual(errors,[]);console.log('PASS: defaults, end tracking, midnight, personal settings, Today, current-time positioning, scrolling months, long press in all views, real touch event drag, ownership/category markers, exact-event and occurrence links, responsive layout');
 }finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});

