// Real date taps against a temporary synthetic database. No production access.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-date-navigation-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'8001'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
  await page.clock.install({time:new Date('2026-10-30T12:00:00Z')});await page.goto('http://127.0.0.1:8001');await page.waitForSelector('.timeline');
  const wait=()=>page.waitForFunction(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active()&&!monthLoading);
  const fixture=await page.evaluate(async()=>{
   state=await api('settings','PATCH',{timezone:'Europe/Warsaw',touch_bar:['month','week','settings']});
   const category=await api('categories','POST',{name:'Date navigation specimen',color:'#D47AAE'});
   const event=await api('events','POST',{title:'October 31 specimen',start:'2026-10-31T12:00',end:'2026-10-31T13:00',timezone:'Europe/Warsaw',category_id:category.id,owner:'both'});
   await api('events','POST',{title:'Filtered out specimen',start:'2026-10-31T14:00',end:'2026-10-31T15:00',timezone:'Europe/Warsaw',owner:'both'});
   filter={owner:'both',category:category.id,status:'planned'};return {category,event};
  });
  const set=async(mode,date,prefs={})=>{
   await page.evaluate(async({mode,date,prefs})=>{state=await api('settings','PATCH',prefs);selected=date;page='main';tab='calendar';await changeView(mode)},{mode,date,prefs});await wait();
  };
  const info=()=>page.evaluate(()=>({selected,view,page,dayLayout:state.me.day_layout,filter:{...filter}}));
  const assertDay=async(date,layout)=>{
   const result=await info();assert.equal(result.selected,date);assert.equal(result.view,'day');assert.equal(result.page,'main');assert.equal(result.dayLayout,layout);
   assert.deepEqual(result.filter,{owner:'both',category:fixture.category.id,status:'planned'});
   assert.equal(await page.locator(layout==='list'?'.day-checklist':'.timeline:not(.week-timeline)').count(),1);
   assert.equal(await page.locator('.month,.month-scroll,.week-strip,.week-timeline-shell').count(),0);
   assert.equal((await page.evaluate(()=>api('state'))).me.view,'day');
  };
  // Both month layouts, with both personal day layouts, including a date already selected.
  // Day deliberately stays hidden from Touch Bar: direct navigation must still work.
  for(const month_layout of ['paged','scroll'])for(const day_layout of ['list','timeline']){
   await set('month','2026-10-31',{month_layout,day_layout});
   const date=page.locator('.day[data-date="2026-10-31"] .day-number');await date.scrollIntoViewIfNeeded();await date.tap();await wait();
   await assertDay('2026-10-31',day_layout);
   const items=page.locator(day_layout==='list'?'.day-task-card':'.time-event');assert.equal(await items.count(),1);assert.match(await items.first().textContent(),/October 31 specimen/);
   assert.equal(await page.locator('.bottom-nav [data-view="day"]').count(),0);
  }
  // All three week layouts use their date headers; choosing a different date must load its events.
  for(const week_layout of ['agenda','three','seven'])for(const day_layout of ['list','timeline']){
   await set('week','2026-10-30',{week_layout,day_layout});
   await page.locator('.week-date[data-date="2026-10-31"] .date-number').tap();await wait();await assertDay('2026-10-31',day_layout);
   assert.equal(await page.locator(day_layout==='list'?'.day-task-card':'.time-event').count(),1);
  }
  // Overflow month cells carry the full ISO date, including the year. Keyboard activation works.
  await set('month','2026-12-31',{month_layout:'paged',day_layout:'list'});
  await page.locator('.day[data-date="2027-01-01"]').focus();await page.keyboard.press('Enter');await wait();await assertDay('2027-01-01','list');
  assert.equal(await page.locator('.day-task-card').count(),0);
  await set('month','2026-10-31',{month_layout:'paged'});
  await page.locator('.day[data-date="2026-11-01"]').focus();await page.keyboard.press('Space');await wait();await assertDay('2026-11-01','list');
  // Timed events retain their displayed calendar date in a different viewer timezone.
  await set('week','2026-10-30',{week_layout:'seven',timezone:'Australia/Melbourne'});
  await page.locator('.week-date[data-date="2026-10-31"]').tap();await wait();await assertDay('2026-10-31','list');
  // An event nested inside a month date opens details rather than the day.
  await set('month','2026-10-31',{month_layout:'scroll',timezone:'Europe/Warsaw'});
  const chip=page.locator(`.day[data-date="2026-10-31"] [data-action="event"][data-id="${fixture.event.id}"]`);
  await chip.scrollIntoViewIfNeeded();await chip.tap();await wait();assert.equal((await info()).page,'detail');assert.equal((await info()).view,'month');
  await page.locator('[data-action="back"]').first().tap();await wait();
  // Failed persistence and data loading both leave the original date/view usable for retry.
  for(const failure of ['settings','events']){
   await set('month','2026-10-30',{month_layout:'paged'});
   await page.evaluate(()=>navigationCache.clear());
   const pattern=failure==='settings'?'**/api/settings':'**/api/events?*';
   await page.route(pattern,r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"test_failure"}'}));
   await page.locator('.day[data-date="2026-10-31"] .day-number').tap();await wait();
   assert.equal((await info()).selected,'2026-10-30');assert.equal((await info()).view,'month');assert.equal(await page.locator('.motion-preview').count(),0);
   await page.unroute(pattern);await page.locator('.day[data-date="2026-10-31"] .day-number').tap();await wait();await assertDay('2026-10-31','list');
  }
  await page.emulateMedia({reducedMotion:'reduce'});await set('week','2026-10-30',{week_layout:'agenda'});
  await page.locator('.week-date[data-date="2026-10-31"]').focus();await page.keyboard.press('Enter');await wait();await assertDay('2026-10-31','list');
  assert.deepEqual(errors,[]);console.log('PASS: month/week date taps, day layouts, filters, hidden Day tab, boundaries, keyboard, timezone, event details, failure/retry, reduced motion');
 }finally{await browser?.close();server.kill();rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
