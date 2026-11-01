// Synthetic profiles and events only. Never calls Telegram or production.
const {chromium}=require('playwright'),{spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict'),{mkdtempSync,rmSync,mkdirSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const dir=mkdtempSync(join(tmpdir(),'calendar-owners-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(dir,'calendar.db'),ARCHIVE_KEY_FILE:join(dir,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(dir,'keys.json'),PORT:'8049'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',s=>{if(String(s).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(Error('server exit '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'Europe/Warsaw'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
  await page.clock.install({time:new Date('2026-11-03T12:00:00Z')});await page.goto('http://127.0.0.1:8049');await page.waitForSelector('.timeline');
  const fixture=await page.evaluate(async()=>{
   state=await api('settings','PATCH',{name:'Alpha',timezone:'Europe/Warsaw',day_layout:'list',touch_bar:['day','week','month','settings']});
   const partner=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({demo_user:'2'})}).then(r=>r.json());
   await fetch('/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+partner.token},body:JSON.stringify({name:'Бета'})});state=await api('state');
   for(const e of new Map((await api('events?start=2026-11-01&end=2026-12-01')).map(e=>[e.id,e])).values())await api('events/'+e.id,'DELETE',{revision:e.revision,confirmed:true});
   const a=await api('categories','POST',{name:'Category one',color:'#D47AAE'}),b=await api('categories','POST',{name:'Category two',color:'#598DD4'});
   const make=(title,hour,owner,category_id)=>api('events','POST',{title,start:`2026-11-03T${hour}:00`,end:`2026-11-03T${hour}:45`,timezone:'Europe/Warsaw',owner,category_id});
   const mine=await make('Owner specimen A','14','1',a.id),other=await make('Owner specimen B','16','2',b.id),both=await make('Owner specimen Both','19','both',a.id);
   categories=await api('categories');events=await api('events?start=2026-11-03&end=2026-11-04');
   return {mine,other,both};
  });
  // Rendering variants reuse the API-verified fixture; no repeated writes/prefetch storm.
  const set=async(mode,prefs={})=>page.evaluate(({mode,prefs})=>{Object.assign(state.me,prefs);selected='2026-11-03';page='main';tab='calendar';showSearch=false;query='';view=mode;render()},{mode,prefs});
  const inspect=async selector=>{
   const rows=page.locator(selector);assert.equal(await rows.count(),3);
   const a=page.locator(`${selector}[data-id="${fixture.mine.id}"]`),b=page.locator(`${selector}[data-id="${fixture.other.id}"]`),both=page.locator(`${selector}[data-id="${fixture.both.id}"]`);
   assert.equal(await a.locator('.owner-avatars').getAttribute('aria-label'),'Alpha');assert.equal(await b.locator('.owner-avatars').getAttribute('aria-label'),'Бета');
   assert.equal(await both.locator('.owner-avatars').getAttribute('aria-label'),'Alpha, Бета');assert.equal(await both.locator('.owner-avatar').count(),2);
   const colors=await rows.evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n.querySelector('.owner-avatar')).backgroundColor));assert.equal(new Set(colors).size,1);
   for(const row of await rows.all())assert.ok(await row.locator('.owner-avatars').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('button').getBoundingClientRect();return a.left>=b.left&&a.right<=b.right+1}));
  };
  for(const language of ['ru','en'])for(const theme of ['light','dark'])for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});
   for(const mode of ['day','week','month']){await set(mode,{language,theme,day_layout:'list',week_layout:'agenda',month_layout:'paged'});await inspect('.day-task-card');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)}
   await set('day',{day_layout:'timeline'});await inspect('.time-event');
   assert.equal(await page.locator('.time-event .owner-avatars-compact').count(),3);
   if(process.env.CALENDAR_SCREENSHOT_DIR&&width===390&&language==='ru'){
    mkdirSync(process.env.CALENDAR_SCREENSHOT_DIR,{recursive:true});await set('week',{day_layout:'list',week_layout:'agenda'});
    await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,`owners-${theme}.png`)});
   }
  }
  await set('day',{day_layout:'list'});
  // A tap on an avatar still opens its event; the completion control stays independent.
  let box=await page.locator(`.day-task-card[data-id="${fixture.mine.id}"] .owner-avatars`).boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await page.waitForSelector('.detail-title');
  assert.equal(await page.evaluate(()=>currentEvent.id),fixture.mine.id);await page.locator('[data-action=back]').first().click();await page.waitForSelector('.day-tasks');
  await page.locator(`.task-check[data-id="${fixture.mine.id}"]`).click();await page.waitForFunction(id=>events.find(e=>e.id===id)?.status==='done',fixture.mine.id);
  await page.evaluate(async()=>{showSearch=true;query='Owner specimen';await loadData();render()});await inspect('.event');
  await set('day',{day_layout:'list'});
  await page.evaluate(async()=>{state=await api('settings','PATCH',{name:'<img src=x onerror="window.ownerXss=true">'});render()});
  assert.equal(await page.locator('.owner-avatars img').count(),0);assert.equal(await page.evaluate(()=>window.ownerXss),undefined);
  assert.equal(await page.locator(`.day-task-card[data-id="${fixture.mine.id}"] .owner-avatar`).textContent(),'<');
  assert.deepEqual(errors,[]);console.log('PASS: owner initials, shared pair, neutral colours, all lists/day timeline, profile updates, safe labels, event taps, completion, RU/EN and mobile widths');
 }finally{await browser?.close();server.kill();rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
