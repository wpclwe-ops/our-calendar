// Real touch input against a temporary synthetic calendar; never production data.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-list-swipes-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'8031'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
  await page.clock.install({time:new Date('2026-10-30T12:00:00Z')});await page.goto('http://127.0.0.1:8031');await page.waitForSelector('.timeline');
  // This test resets dozens of screens programmatically; avoid speculative requests exhausting the API rate limit.
  // Ordinary navigation with prefetch is covered by the navigation browser scenarios.
  await page.evaluate(()=>{warmNavigation=()=>{}});
  const cdp=await context.newCDPSession(page);
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:['touchEnd','touchCancel'].includes(type)?[]:[{x,y}]});
  const idle=async()=>{for(let i=0;i<100;i++){if(await page.evaluate(()=>!busy&&!calendarTouch.active()&&!calendarSwipe.active()&&!monthLoading))return;await page.waitForTimeout(30)}throw new Error('UI did not become idle')};
  const show=async(mode='day',prefs={},search=false)=>{
   await page.evaluate(async({mode,prefs,search})=>{state=await api('settings','PATCH',{day_layout:'list',week_layout:'agenda',month_layout:'paged',touch_bar:['day','week','month','categories','settings'],...prefs});page='main';tab='calendar';view=mode;selected='2026-10-30';showSearch=search;query=search?'Swipe specimen':'';await loadData();render()},{mode,prefs,search});await idle();
  };
  const make=async(extra={})=>page.evaluate(extra=>api('events','POST',{title:'Swipe specimen',start:'2026-10-30T13:00',end:'2026-10-30T14:00',timezone:'Europe/Warsaw',owner:'both',...extra}),extra);
  const card=id=>page.locator(`.day-task-card[data-id="${id}"],.search-page .event[data-id="${id}"]`).first();
  const point=async(id)=>{await card(id).evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(80);const b=await card(id).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2}};
  async function swipe(id,dx,{hold=520,dy=0,cancel=false}={}){
   const p=await point(id);await touch('touchStart',p.x,p.y);await page.waitForTimeout(hold);
   for(let i=1;i<=6;i++){await touch('touchMove',p.x+dx*i/6,p.y+dy*i/6);await page.waitForTimeout(16)}
   await touch(cancel?'touchCancel':'touchEnd');await page.waitForTimeout(120);
  }
  const back=async()=>{await page.waitForTimeout(680);await page.locator('[data-action=back]').first().click();await idle()};
  // All list surfaces: direct editor, cancellation back to the same list, centred delete and no deletion on Cancel.
  for(const [mode,search] of [['day',false],['week',false],['month',false],['day',true]]){
   console.log('Checking list',mode,search?'search':'');
   const event=await make();await show(mode,{},search);
   await swipe(event.id,76);await page.waitForSelector('#event-form');
   assert.equal(await page.locator('[name=title]').inputValue(),'Swipe specimen');
   assert.equal(await page.locator('.event-detail').count(),0,'editor bypasses detail');
   await back();assert.equal(await page.evaluate(()=>view),mode);assert.equal(await page.evaluate(()=>showSearch),search);
   await swipe(event.id,-76);await page.waitForSelector('.centered-confirmation');
   const b=await page.locator('.centered-confirmation .modal').boundingBox();assert.ok(Math.abs(b.y+b.height/2-422)<2,'delete confirmation is centred');
   if(mode==='day'&&!search&&process.env.CALENDAR_SWIPE_SCREENSHOT)await page.screenshot({path:process.env.CALENDAR_SWIPE_SCREENSHOT});
   assert.match(await page.locator('.centered-confirmation').textContent(),/Swipe specimen/);
   await page.waitForTimeout(680);await page.locator('[data-choice=no]').click();await idle();assert.equal(await card(event.id).count(),1);
   await swipe(event.id,-76);await page.waitForSelector('.centered-confirmation');await page.waitForTimeout(680);await page.locator('[data-choice=yes]').click();await idle();
   assert.equal(await card(event.id).count(),0);assert.ok((await page.evaluate(()=>api('events?trash=true'))).some(e=>e.id===event.id));
  }
  // Saving a quick edit returns to the list and preserves date, filters and scroll position.
  const event=await make();for(let i=0;i<12;i++)await make({title:'Filler '+i});await show();
  await page.locator('.day-checklist').evaluate(el=>el.scrollTop=300);
  await swipe(event.id,76);await page.waitForSelector('#event-form');const before=await page.evaluate(()=>formReturn.top);
  await page.locator('[name=title]').fill('Swipe specimen changed');await page.waitForTimeout(680);await page.locator('#event-form').evaluate(el=>el.requestSubmit());await idle();
  assert.equal(await page.evaluate(()=>page),'main');assert.equal(await page.evaluate(()=>selected),'2026-10-30');assert.ok(Math.abs(await page.locator('.day-checklist').evaluate(el=>el.scrollTop)-before)<2);
  assert.equal((await page.evaluate(id=>api('events/'+id),event.id)).title,'Swipe specimen changed');
  // Hold alone, a short stroke, touch cancellation and reversal never trigger an action or an accidental click.
  for(const options of [{dx:0},{dx:22},{dx:-76,cancel:true}]){
   await show();await swipe(event.id,options.dx,options);await idle();assert.equal(await page.evaluate(()=>page),'main');assert.equal(await page.locator('.modal-backdrop').count(),0);assert.equal(await page.locator('.list-swipe-hint').count(),0);
  }
  await show();let p=await point(event.id);await touch('touchStart',p.x,p.y);await page.waitForTimeout(520);await touch('touchMove',p.x-80,p.y);await touch('touchMove',p.x-5,p.y);await touch('touchEnd');await idle();assert.equal(await page.locator('.modal-backdrop').count(),0);
  // Multitouch and a vertical movement after arming cancel the row gesture.
  await show();p=await point(event.id);await touch('touchStart',p.x,p.y);await page.waitForTimeout(520);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x:p.x,y:p.y},{id:1,x:p.x+30,y:p.y+30}]});await touch('touchCancel');await idle();assert.equal(await page.locator('.list-swipe-hint,.modal-backdrop').count(),0);
  await show();await swipe(event.id,0,{dy:55});await idle();assert.equal(await page.locator('.list-swipe-hint,.modal-backdrop').count(),0);
  // Before arming, horizontal motion still changes the date, vertical motion still scrolls, and tapping opens details.
  await show();await swipe(event.id,-80,{hold:20});await idle();assert.equal(await page.evaluate(()=>selected),'2026-10-31');assert.equal(await page.evaluate(()=>page),'main');
  await show();await page.locator('.day-checklist').evaluate(el=>el.scrollTop=0);const first=await page.locator('.day-task-card').first().getAttribute('data-id');
  await swipe(first,0,{hold:20,dy:-80});await idle();assert.ok(await page.locator('.day-checklist').evaluate(el=>el.scrollTop)>30);assert.equal(await page.locator('.modal-backdrop').count(),0);
  await show();p=await point(event.id);await touch('touchStart',p.x,p.y);await page.waitForTimeout(30);await touch('touchEnd');await page.waitForSelector('.detail-title');await back();
  // Completion remains an independent tap control.
  await show();await page.waitForTimeout(680);await page.locator(`.task-check[data-id="${event.id}"]`).click();await idle();assert.equal((await page.evaluate(id=>api('events/'+id),event.id)).status,'done');
  // Recurrence uses the existing scope selector, with cancellation and this-instance changes.
  console.log('Checking recurrence');
  const series=await make({rrule:'FREQ=DAILY;COUNT=3'});await show();await swipe(series.id,76);await page.waitForSelector('.modal-backdrop');
  await page.waitForTimeout(680);await page.locator('[data-choice=cancel]').click();await idle();assert.equal(await page.evaluate(()=>page),'main');
  await swipe(series.id,76);await page.waitForTimeout(680);await page.locator('[data-choice=one]').click();await page.waitForSelector('#event-form');
  await page.locator('[name=title]').fill('One occurrence edited');await page.locator('#event-form').evaluate(el=>el.requestSubmit());await idle();
  assert.equal(await page.evaluate(()=>page),'main');
  assert.equal(await card(series.id).locator('.day-task-title').textContent(),'One occurrence edited');
  await swipe(series.id,-76);await page.waitForTimeout(680);await page.locator('[data-choice=one]').click();await page.waitForSelector('.centered-confirmation');await page.locator('[data-choice=yes]').click();await idle();assert.equal(await card(series.id).count(),0);
  const future=await page.evaluate(()=>api('events?start=2026-10-31&end=2026-11-02'));assert.equal(future.filter(e=>e.id===series.id).length,2);
  // A denied/stale deletion leaves the row intact and lets the user retry.
  await show();await page.route(`**/api/events/${event.id}*`,route=>route.request().method()==='DELETE'?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'revision_conflict'})}):route.continue());
  await swipe(event.id,-76);await page.waitForTimeout(680);await page.locator('[data-choice=yes]').click();await idle();assert.equal(await card(event.id).count(),1);assert.equal(await page.locator('#toast').isVisible(),true);await page.unroute(`**/api/events/${event.id}*`);
  await page.route(`**/api/events/${event.id}*`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'event_not_found'})}));
  await swipe(event.id,76);await idle();assert.equal(await page.evaluate(()=>page),'main');assert.equal(await card(event.id).count(),1);await page.unroute(`**/api/events/${event.id}*`);
  // No empty bottom strip: day/week/month scrollports and categories/settings reach the viewport edge.
  console.log('Checking bottom coverage');
  for(const theme of ['light','dark'])for(const width of [320,390,430]){
   await page.setViewportSize({width,height:width===320?568:844});
   for(const [mode,prefs,selector] of [['day',{},'.day-checklist'],['week',{},'.agenda'],['week',{week_layout:'three'},'.timeline'],['week',{week_layout:'seven'},'.timeline'],['month',{},'.month-with-agenda'],['month',{month_layout:'scroll'},'.month-scroll']]){
    await page.evaluate(({mode,theme,prefs})=>{state.me={...state.me,theme,day_layout:'list',week_layout:'agenda',month_layout:'paged',...prefs};tab='calendar';page='main';showSearch=false;view=mode;render()},{mode,theme,prefs});
    assert.ok(Math.abs((await page.locator(selector).boundingBox()).y+(await page.locator(selector).boundingBox()).height-(width===320?568:844))<2,`${theme} ${width} ${mode} reaches bottom`);
    assert.equal(await page.locator('.calendar-actions').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
   }
   for(const target of ['categories','settings']){
    await page.evaluate(target=>{tab=target;page='main';render()},target);
    const box=await page.locator('.navigation-content').boundingBox();assert.ok(Math.abs(box.y+box.height-(width===320?568:844))<2,target+' reaches bottom');
    await page.locator('.navigation-content').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.ok(await page.locator('.navigation-content').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom)>100));
   }
  }
  assert.deepEqual(errors,[]);console.log('PASS: list hold/swipes, confirmation, direct edit, recurrence, cancellation, navigation/scroll/tap and bottom coverage');
 }finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
