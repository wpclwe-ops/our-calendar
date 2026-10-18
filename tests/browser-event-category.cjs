// Real local persistence on a synthetic DB; no external accounts or messages.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-category-'));
 const env={...process.env,DEMO_MODE:'true',OPENAI_API_KEY:'',AUTO_SETUP_BOT:'false',DATABASE_PATH:join(directory,'db.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'8013'};
 const seed=spawnSync('python',['-m','scripts.demo_seed'],{env});assert.equal(seed.status,0,seed.stderr?.toString());
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='PATCH'&&r.url().includes('/api/events/'))writes.push(r.postDataJSON())});
  await page.route('https://telegram.org/**',r=>r.abort());await page.goto('http://127.0.0.1:8013');await page.waitForSelector('.fab');
  const fixture=await page.evaluate(async()=>{
   const a=await api('categories','POST',{name:'Beauty',color:'#B990DD'}),b=await api('categories','POST',{name:'Work',color:'#90BBDD'});
   categories=await api('categories');
   const event=await api('events','POST',{title:'Hair appointment',description:'Preserve description',location:'Salon',start:'2026-10-24T15:30',end:'2026-10-24T20:30',reminders:[60]});await openEvent(event.id);
   return {a:a.id,b:b.id,id:event.id};
  });
  const badge=page.locator('[data-action=category-options]'),pick=id=>page.locator(`[data-action=choose-event-category][data-category="${id||''}"]`);
  const choose=async id=>{await badge.click();await pick(id).click();await page.waitForSelector('.category-picker-backdrop',{state:'detached'})};
  await badge.click();await page.locator('.event-category-picker [data-close]').click();assert.equal(writes.length,0);
  await choose(fixture.a);let event=await page.evaluate(id=>api('events/'+id),fixture.id);
  assert.equal(event.category_id,fixture.a);assert.equal(event.description,'Preserve description');assert.equal(event.location,'Salon');assert.deepEqual(event.reminders['1'],[60]);assert.equal(event.smart.category.manual,true);
  assert.deepEqual(Object.keys(writes.at(-1)).sort(),['category_id','revision']);
  await choose(fixture.b);await page.evaluate(async id=>openEvent(id),fixture.id);assert.equal(await page.evaluate(()=>currentEvent.category_id),fixture.b);
  // A failed save leaves the picker open; the same selection can be retried.
  await page.route('**/api/events/'+fixture.id,async route=>{if(route.request().method()==='PATCH'){await route.fulfill({status:503,json:{error:'error'}});await page.unroute('**/api/events/'+fixture.id)}else await route.continue()});
  await badge.click();await pick(fixture.a).click();await page.waitForFunction(()=>!!document.querySelector('.event-category-picker .error')?.textContent);
  assert.equal(await page.evaluate(()=>currentEvent.category_id),fixture.b);await pick(fixture.a).click();await page.waitForSelector('.category-picker-backdrop',{state:'detached'});
  await choose(null);event=await page.evaluate(id=>api('events/'+id),fixture.id);assert.equal(event.category_id,null);assert.equal(event.smart.category.manual,true);
  // Both provider badges use the identical picker and local-only save path.
  for(const provider of ['google','icloud']){
   await page.evaluate(async({id,provider})=>{await openEvent(id);currentEvent[provider+'_links']=[{state:'ready'}];render()},{id:fixture.id,provider});
   await choose(fixture.b);
  }
  const series=await page.evaluate(async()=>{const e=await api('events','POST',{title:'Recurring appointment',start:'2026-10-24T10:00',end:'2026-10-24T11:00',rrule:'FREQ=DAILY;COUNT=3'});await openEvent(e.id);return {id:e.id,key:currentEvent.occurrence}});
  await choose(fixture.a);event=await page.evaluate(id=>api('events/'+id),series.id);assert.equal(event.category_id,null);assert.equal(await page.evaluate(()=>currentEvent.category_id),fixture.a);
  await page.evaluate(async id=>openEvent(id,'2026-10-25T10:00'),series.id);
  await badge.click();await page.selectOption('[name=category-scope]','following');await pick(fixture.b).click();await page.waitForSelector('.category-picker-backdrop',{state:'detached'});assert.equal(await page.evaluate(()=>currentEvent.category_id),fixture.b);
  await badge.click();await page.selectOption('[name=category-scope]','all');await pick(fixture.a).click();await page.waitForSelector('.category-picker-backdrop',{state:'detached'});assert.equal((await page.evaluate(()=>api('events/'+currentEvent.id))).category_id,fixture.a);
  for(const [width,language,theme] of [[320,'ru','light'],[390,'en','dark'],[430,'ru','dark']]){
   await page.setViewportSize({width,height:844});await page.evaluate(async({language,theme})=>{state=await api('settings','PATCH',{language,theme});render()},{language,theme});await badge.click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.keyboard.press('Escape');assert.equal(await page.locator('.category-picker-backdrop').count(),0);
  }
  assert.deepEqual(errors,[]);console.log('Quick categories passed: assign/change/clear, cancel, failure/retry, minimal local payload, manual protection, both provider cards, all recurrence scopes, RU/EN and mobile sizes.');
 }finally{if(browser)await browser.close();server.kill();rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
