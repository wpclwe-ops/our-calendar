// Deterministic delayed-poll regressions; fresh synthetic data, never production.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-transition-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'8000'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',code=>reject(new Error('server exit '+code)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://telegram.org/**',route=>route.abort());
  await page.addInitScript(()=>{
   const interval=window.setInterval;window.testPollCallbacks=[];
   // Drive the ordinary background interval at exact request boundaries.
   window.setInterval=(fn,ms,...args)=>{if(ms===15000){window.testPollCallbacks.push(()=>fn(...args));return 0}return interval(fn,ms,...args)};
  });
  await page.goto('http://127.0.0.1:8000');await page.waitForSelector('.timeline');
  const wait=()=>page.waitForFunction(()=>!busy&&!calendarSwipe.active());
  await page.evaluate(()=>api('events','POST',{title:'Month-only specimen',start:'2026-10-25T12:00',end:'2026-10-25T13:00',timezone:'UTC'}));
  async function prepare(layout){
   await page.evaluate(async layout=>{
    state=await api('settings','PATCH',{month_layout:layout,day_layout:'timeline',touch_bar:['day','week','month','settings']});
    selected='2026-10-16';view='day';tab='calendar';page='main';monthWindow=[];
    pollRenderPending=false;await loadData();render();
   },layout);await wait();
  }
  async function gate(pattern,predicate=()=>true){
   let saw,release;const seen=new Promise(resolve=>saw=resolve),held=new Promise(resolve=>release=resolve);
   await page.route(pattern,async route=>{if(predicate(route.request())){saw();await held}await route.continue()});
   return {release,seen:()=>Promise.race([seen,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('No request for '+pattern)),10000);timer.unref()})]),close:()=>page.unroute(pattern)};
  }
  const startPoll=()=>page.evaluate(()=>{window.testPollDone=Promise.all(window.testPollCallbacks.map(fn=>fn()))});
  const finishPoll=()=>page.evaluate(()=>window.testPollDone);
  async function assertMonth(layout){
   await wait();
   assert.equal(await page.evaluate(()=>view),'month');
   assert.equal(await page.locator('.calendar-motion-page:not(.motion-preview)').getAttribute('data-view'),'month');
   assert.equal(await page.locator('.bottom-nav [data-view="month"]').getAttribute('aria-current'),'page');
   assert.ok(await page.locator(layout==='scroll'?'.month-scroll':'.month-with-agenda').isVisible());
   assert.equal(await page.locator('.motion-preview').count(),0);
   assert.ok(await page.evaluate(()=>events.some(event=>event.title==='Month-only specimen')),'month event data survives delayed day requests');
   if(layout==='scroll'){
    assert.equal(await page.evaluate(()=>monthWindow.length),3,'live scroll window is committed with the month');
    assert.ok(await page.locator('.month-scroll .chosen-date').isVisible());
   }
  }
  // A poll may be waiting for state or categories when the user taps Month.
  // New day data would normally make that poll redraw the outgoing day.
  for(const layout of ['paged','scroll'])for(const stage of ['state','categories']){
   await prepare(layout);await page.waitForTimeout(650);
   const poll=await gate('**/api/'+stage);
   await startPoll();await poll.seen();
   await page.evaluate(stage=>api('events','POST',{title:'Concurrent '+stage+' '+Date.now(),start:'2026-10-16T14:00',end:'2026-10-16T15:00',timezone:'UTC'}),stage);
   const preference=await gate('**/api/settings',request=>request.method()==='PATCH');
   await page.locator('.bottom-nav [data-view="month"]').tap();await preference.seen();
   poll.release();await finishPoll();preference.release();
   await assertMonth(layout);await poll.close();await preference.close();
  }
  // A day-events response may arrive after the month transition has committed.
  for(const layout of ['paged','scroll']){
   await prepare(layout);await page.waitForTimeout(650);
   const poll=await gate('**/api/events?*',request=>new URL(request.url()).searchParams.get('start')==='2026-10-15');
   await startPoll();await poll.seen();
   await page.locator('.bottom-nav [data-view="month"]').tap();await assertMonth(layout);
   poll.release();await finishPoll();await assertMonth(layout);await poll.close();
  }
  // Other legitimate redraws (such as a focus refresh) cannot strand a transition
  // on a detached page, even if polling was already suppressed.
  await prepare('paged');
  const preference=await gate('**/api/settings',request=>request.method()==='PATCH');
  await page.locator('.bottom-nav [data-view="month"]').tap();await preference.seen();
  await page.evaluate(()=>render());preference.release();await assertMonth('paged');await preference.close();
  for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  assert.deepEqual(errors,[]);
  console.log('PASS: single-tap Day-to-Month, delayed state/categories/events polls, detached viewport fallback, paged/scrolling month and retained month data/window.');
 }finally{await browser?.close();server.kill();rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exit(1)});
