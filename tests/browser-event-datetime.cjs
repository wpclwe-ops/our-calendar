// Real UI/touch input and API round trips, temporary synthetic database only.
const {chromium}=require('playwright'),{spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict'),{mkdtempSync,rmSync,mkdirSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const dir=mkdtempSync(join(tmpdir(),'calendar-datetime-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(dir,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(dir,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(dir,'keys.json'),PORT:'8032'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','ignore','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.once('exit',c=>reject(Error('server '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'America/Los_Angeles'}),page=await context.newPage();
  const errors=[],mutations=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&/\/api\/events/.test(r.url()))mutations.push(r.url())});
  await page.route('https://telegram.org/**',r=>r.abort());await page.clock.install({time:new Date('2026-10-30T18:30:00Z')});
  await page.goto('http://127.0.0.1:8032');await page.waitForSelector('.fab');
  await page.evaluate(async()=>{warmNavigation=()=>{};state=await api('settings','PATCH',{timezone:'Europe/Warsaw',theme:'dark',day_layout:'list'});selected='2026-10-30';await loadData();render()});
  const idle=async()=>{for(let i=0;i<120;i++){if(await page.evaluate(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active()))return;await page.waitForTimeout(25)}throw Error('not idle')};
  const dialog=()=>page.locator('.event-datetime-picker'),wheel=name=>dialog().locator(`[data-ed-wheel=${name}]`);
  const open=async(field='start')=>{await page.locator(`[data-action=event-datetime]`).click();await dialog().waitFor();if(field==='end')await dialog().locator('[data-ed-tab=end]').click();await idle();await page.waitForTimeout(300)};
  const setClock=async(name,n)=>{await wheel(name).focus();await page.keyboard.press('Home');for(let i=0;i<n;i++)await page.keyboard.press('ArrowDown')};
  const chooseDate=async(date)=>{await dialog().locator('[data-ed-date-toggle]').click();
   for(let i=0;i<36;i++){
    const dates=await dialog().locator('[data-ed-day-choice]').evaluateAll(nodes=>nodes.map(n=>n.dataset.edDayChoice));
    if(dates.includes(date)){await dialog().locator(`[data-ed-day-choice="${date}"]`).click();return}
    await dialog().locator(`[data-ed-month="${date<dates[0]?-1:1}"]`).click();
   }throw Error('date not found '+date);
  };
  const done=async()=>{await dialog().locator('[data-ed-done]').click();await page.waitForSelector('.event-datetime-picker',{state:'detached'});await idle()};
  const screenshot=async name=>{if(process.env.CALENDAR_SCREENSHOT_DIR){mkdirSync(process.env.CALENDAR_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,name+'.png')})}};
  console.log('Checking new event, cancellation, time wheels and date');
  await page.locator('[data-action=new]').click();await page.locator('[name=title]').fill('Wheel specimen');
  assert.equal(await page.locator('input[type=datetime-local]').count(),0);
  assert.equal(await page.inputValue('[name=start]'),'2026-10-30T19:30','event timezone, not browser timezone');
  await open();assert.equal(await page.locator('#app').evaluate(el=>el.inert),true);await screenshot('datetime-wheels-dark');
  await setClock('hour',21);assert.equal(await dialog().locator('[data-ed-time=start]').textContent(),'21:30');
  await dialog().locator('[data-ed-cancel]').click();assert.equal(await page.inputValue('[name=start]'),'2026-10-30T19:30');assert.equal(await page.locator('#app').evaluate(el=>el.inert),false);
  await page.locator('[data-action=event-datetime]').click();await dialog().waitFor();await dialog().locator('[data-ed-cancel]').click();
  await open();await setClock('hour',23);await setClock('minute',55);assert.equal(await dialog().locator('[data-ed-time=end]').textContent(),'00:55');assert.match(await dialog().locator('[data-ed-day=end]').textContent(),/31/);
  await chooseDate('2026-11-01');await done();assert.equal(await page.inputValue('[name=start]'),'2026-11-01T23:55');assert.equal(await page.inputValue('[name=end]'),'2026-11-02T00:55');
  assert.equal(await page.inputValue('[name=title]'),'Wheel specimen');assert.equal(mutations.length,0,'choosing time does not save an event');
  await open('end');await setClock('hour',1);await setClock('minute',7);await done();assert.equal(await page.inputValue('[name=end]'),'2026-11-02T01:07','exact non-five-minute value');
  // User-set end remains fixed while it is valid, matching the existing form rule.
  await open();await setClock('minute',45);await done();assert.equal(await page.inputValue('[name=end]'),'2026-11-02T01:07');
  await page.locator('.header-save').click();await idle();await page.waitForSelector('.detail-title');const created=await page.evaluate(()=>currentEvent);
  assert.equal(created.start,'2026-11-01T23:45');assert.equal(created.end,'2026-11-02T01:07');
  console.log('Checking editing, presets and other form fields');
  await page.locator('[data-action=edit-event]').click();await page.locator('[name=location]').fill('Synthetic venue');
  await open();await dialog().locator('[data-ed-duration="90"]').click();await done();assert.equal(await page.inputValue('[name=end]'),'2026-11-02T01:15');assert.equal(await page.inputValue('[name=location]'),'Synthetic venue');
  await page.locator('.header-save').click();await idle();assert.equal((await page.evaluate(()=>currentEvent)).location,'Synthetic venue');
  // Real touch moves only its own wheel, does not scroll the dialog, and cancellation restores it.
  await page.locator('[data-action=edit-event]').click();await open();const cdp=await context.newCDPSession(page);
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:['touchEnd','touchCancel'].includes(type)?[]:[{x,y}]});
  let box=await wheel('minute').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;const beforeHour=await wheel('hour').getAttribute('aria-valuenow'),beforeMinute=Number(await wheel('minute').getAttribute('aria-valuenow')),top=await dialog().evaluate(el=>el.scrollTop);
  await touch('touchStart',x,y);for(let i=1;i<=8;i++){await touch('touchMove',x,y-i*11);await page.waitForTimeout(22)}await touch('touchEnd');
  assert.equal(Number(await wheel('minute').getAttribute('aria-valuenow')),(beforeMinute+2)%60);assert.equal(await wheel('hour').getAttribute('aria-valuenow'),beforeHour);assert.equal(await dialog().evaluate(el=>el.scrollTop),top);
  const checkpoint=await wheel('minute').getAttribute('aria-valuenow');await touch('touchStart',x,y);await touch('touchMove',x,y-88);await touch('touchCancel');assert.equal(await wheel('minute').getAttribute('aria-valuenow'),checkpoint);
  await page.keyboard.press('Escape');assert.equal(await dialog().count(),0);
  console.log('Checking DST and invalid end date');
  await page.evaluate(()=>{newEvent('2026-03-29',90)});await open();await setClock('hour',2);await setClock('minute',30);assert.equal(await dialog().locator('[data-ed-done]').isDisabled(),true);assert.match(await dialog().locator('.ed-error').textContent(),/летнее/);await dialog().locator('[data-ed-cancel]').click();
  await page.evaluate(()=>{newEvent('2026-10-25',150)});await open();assert.equal(await dialog().locator('[data-ed-done]').isDisabled(),true);await dialog().locator('[data-ed-fold=start][value="1"]').check();assert.equal(await dialog().locator('[data-ed-done]').isDisabled(),false);await done();assert.equal(await page.evaluate(()=>formEvent.fold),1);
  await open('end');await chooseDate('2026-10-24');assert.equal(await dialog().locator('[data-ed-done]').isDisabled(),true);await dialog().locator('[data-ed-duration="60"]').click();await done();
  console.log('Checking recurring event scope');
  const series=await page.evaluate(()=>api('events','POST',{title:'Wheel series',start:'2026-11-03T12:00',end:'2026-11-03T13:00',timezone:'Europe/Warsaw',owner:'both',rrule:'FREQ=DAILY;COUNT=3'}));
  await page.evaluate(id=>openEvent(id,'2026-11-04T12:00'),series.id);await page.locator('[data-action=edit-event]').click();await page.locator('[data-choice=one]').click();await open();await setClock('minute',17);await done();await page.locator('.header-save').click();await idle();
  const rows=await page.evaluate(()=>api('events?start=2026-11-03&end=2026-11-06'));assert.equal(rows.find(e=>e.id===series.id&&e.occurrence==='2026-11-04T12:00').start,'2026-11-04T12:17');assert.equal(rows.find(e=>e.id===series.id&&e.occurrence==='2026-11-03T12:00').start,'2026-11-03T12:00');
  for(const scope of ['all','following']){
   const event=await page.evaluate(scope=>api('events','POST',{title:'Wheel '+scope,start:'2026-12-03T12:00',end:'2026-12-03T13:00',timezone:'Europe/Warsaw',owner:'both',rrule:'FREQ=DAILY;COUNT=3'}),scope);
   await page.evaluate(id=>openEvent(id,'2026-12-04T12:00'),event.id);await page.locator('[data-action=edit-event]').click();await page.locator(`[data-choice=${scope}]`).click();await open('end');await dialog().locator('[data-ed-duration="30"]').click();await done();await page.locator('.header-save').click();await idle();
   const actual=await page.evaluate(scope=>api('events?start=2026-12-03&end=2026-12-06').then(rows=>rows.filter(e=>e.title==='Wheel '+scope).sort((a,b)=>a.start.localeCompare(b.start)).map(e=>(Date.parse(e.end+'Z')-Date.parse(e.start+'Z'))/60000)),scope);
   assert.deepEqual(actual,scope==='all'?[30,30,30]:[60,30,30]);
  }
  console.log('Checking size, focus, localization and all-day compatibility');
  for(const language of ['ru','en'])for(const theme of ['light','dark'])for(const width of [320,390,430]){
   await page.setViewportSize({width,height:width===320?568:844});await page.evaluate(({language,theme})=>{state.me.language=language;state.me.theme=theme;newEvent('2026-12-31',1410)},{language,theme});await open();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.ok(await dialog().evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight}));
   assert.equal(await wheel('hour').evaluate(el=>getComputedStyle(el).touchAction),'none');
   await dialog().locator('[data-ed-date-toggle]').click();assert.equal(await dialog().locator('[data-ed-day-choice]').count(),35);
   await dialog().locator('[data-ed-done]').scrollIntoViewIfNeeded();const finish=await dialog().locator('[data-ed-done]').boundingBox();assert.ok(finish.y>=0&&finish.y+finish.height<=(width===320?568:844),'Done stays reachable in a short WebView');
   await screenshot(`datetime-calendar-${language}-${theme}-${width}`);
   await page.keyboard.press('Escape');assert.equal(await dialog().count(),1,'Escape first closes the calendar');await page.keyboard.press('Escape');assert.equal(await dialog().count(),0);
   assert.equal(await page.locator('[data-action=event-datetime][data-field=start]').evaluate(el=>el===document.activeElement),true);
  }
  await open();await dialog().locator('[data-ed-all-day]').check();await done();assert.equal(await page.locator('[name=start]').getAttribute('type'),'hidden');assert.equal(await page.evaluate(()=>formEvent.all_day),true);await open();await dialog().locator('[data-ed-all-day]').uncheck();await done();assert.equal(await page.locator('[data-action=event-datetime]').count(),1);
  assert.deepEqual(errors,[]);console.log('PASS: create/edit, real touch, exact minute, date/duration, cancel/apply, DST/folds, recurrence, all-day, RU/EN themes and responsive dialog');
 }finally{await browser?.close();const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
