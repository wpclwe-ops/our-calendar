// Synthetic local UI acceptance; no API key or external calendar access.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-smart-'));
 const env={...process.env,DEMO_MODE:'true',OPENAI_API_KEY:'',AUTO_SETUP_BOT:'false',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'8011'};
 const seeded=spawnSync('python',['-m','scripts.demo_seed'],{env});assert.equal(seeded.status,0,seeded.stderr?.toString());
 const background=id=>{
  const code="import runpy; from app.config import Config; from app.db import Database; from app.service import Service; from app.smart_events import SmartEvents; from dataclasses import replace; c=replace(Config.env(),openai_api_key='synthetic-not-real'); s=Service(Database(c.database),c); fake=runpy.run_path('tests/test_smart_events.py')['FakeAI'](); s.settings('1',{'smart_events':{'consent':True,'include_internal':True}}); s.settings('2',{'smart_events':{'consent':True,'include_internal':True}}); smart=SmartEvents(s,fake); smart.request('1',__import__('sys').argv[1]); smart.process()";
  const result=spawnSync('python',['-c',code,id],{env});assert.equal(result.status,0,result.stderr?.toString());
 };
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
  await page.goto('http://127.0.0.1:8011');await page.waitForSelector('.fab');
  const id=await page.evaluate(async()=>{const e=await api('events','POST',{title:'Corner Salon: Tonowanie','start':'2026-10-24T12:00','end':'2026-10-24T13:00',translations:{ru:{title:'Уход за волосами',description:''},en:{title:'Hair treatment',description:''}}});await openEvent(e.id);return e.id});
  assert.equal(await page.locator('.description-card').count(),0,'translated title does not create an empty description card');
  assert.equal(await page.locator('[data-action=detail-language]').count(),2,'title-only events retain language controls');
  await page.locator('[data-action=detail-language][data-lang=en]').click();assert.equal(await page.locator('.detail-title').textContent(),'Hair treatment');
  await page.locator('[data-action=smart-short-edit]').click();await page.locator('.smart-dialog input[name=ru]').fill('Мой салон');await page.locator('.smart-dialog input[name=en]').fill('My salon');await page.locator('.smart-dialog input[name=remember]').check();
  background(id);
  await page.locator('.smart-dialog button[type=submit]').click();await page.waitForSelector('.smart-dialog',{state:'detached'});
  const saved=await page.evaluate(async id=>api('events/'+id),id);assert.equal(saved.smart.short_titles.ru,'Мой салон');assert.equal(saved.title,'Corner Salon: Tonowanie');
  await page.route('**/api/google',r=>r.fulfill({json:{configured:true,accounts:[{state:'connected',sources:[{selected:true,state:'ready'}]}]}}));
  let appleState='connected';
  await page.route('**/api/icloud',r=>r.fulfill({json:{configured:true,accounts:[{state:appleState,sources:[{selected:true,state:'ready'}]}]}}));
  await page.evaluate(async()=>{tab='settings';page='main';await loadData();await openSettingsSection('connections')});assert.deepEqual(await page.locator('.provider-status').allTextContents(),['Работает','Работает']);
  appleState='needs_reconnect';await page.evaluate(async()=>{page='main';await loadData();await openSettingsSection('connections')});
  assert.deepEqual(await page.locator('.provider-status').allTextContents(),['Работает','Нужно войти заново']);
  appleState='connected';await page.evaluate(async()=>{page='main';await loadData();await openSettingsSection('memory')});
  assert.equal(await page.locator('.smart-rule').count(),1);
  await page.evaluate(()=>openSettingsSection('events'));await page.waitForSelector('[data-smart-pref=consent]');
  assert.ok((await page.locator('#app').textContent()).includes('OpenAI'));
  assert.equal(await page.locator('[data-smart-pref=display_short]').count(),0);
  await page.locator('[data-smart-pref=categorize]').uncheck();await page.waitForFunction(()=>state.me.smart_events?.categorize===false);
  await page.locator('[data-smart-pref=categorize]').check();await page.waitForFunction(()=>state.me.smart_events?.mode==='auto');
  await page.locator('[data-smart-pref=titles]').uncheck();await page.waitForFunction(()=>state.me.smart_events?.titles===false);
  assert.equal(await page.evaluate(async id=>title(await api('events/'+id)),id),'Уход за волосами');
  await page.locator('[data-smart-pref=titles]').check();await page.waitForFunction(()=>state.me.smart_events?.titles===true);
  await page.evaluate(async()=>{state=await api('settings','PATCH',{smart_events:{display_short:false}})});
  await page.evaluate(()=>render());await page.locator('[data-smart-pref=consent]').uncheck();await page.waitForFunction(()=>state.me.smart_events?.consent===false);
  await page.locator('[data-smart-pref=consent]').check();await page.waitForFunction(()=>state.me.smart_events?.consent===true);
  // One title in details and every calendar layout, even for a legacy display_short=false profile.
  for(const [view,layout,key] of [['day','list','day_layout'],['day','timeline','day_layout'],['week','agenda','week_layout'],['week','three','week_layout'],['week','seven','week_layout'],['month','paged','month_layout'],['month','scroll','month_layout']]){
   await page.evaluate(async({view,layout,key})=>{state=await api('settings','PATCH',{[key]:layout});selected='2026-10-24';page='main';tab='calendar';window.scrollTo(0,0);await changeView(view)},{view,layout,key});
   assert.ok((await page.locator('.day-task-title,.event-title,.time-event-title,.month-event-title,.week-all-event').allTextContents()).some(t=>t.includes('Мой салон')),view+' '+layout+' uses calendar title');
  }
  await page.evaluate(async id=>openEvent(id),id);
  assert.equal(await page.locator('.detail-title').textContent(),'Мой салон');
  assert.ok((await page.locator('.smart-original').textContent()).includes('Corner Salon: Tonowanie'));
  // A full form opened before AI completion preserves untouched translated fields.
  const flight=await page.evaluate(async()=>{const e=await api('events','POST',{title:'Flight · Wrocław → Amsterdam','description':'Trip details','start':'2026-10-24T15:00','end':'2026-10-24T17:00'});await openEvent(e.id);return e.id});
  await page.locator('[data-action=edit-event]').click();await page.locator('[name=location]').fill('Airport');background(flight);
  await page.locator('[type=submit][form=event-form]').click();await page.waitForSelector('.detail-title');
  const updated=await page.evaluate(async id=>api('events/'+id),flight);
  assert.equal(updated.location,'Airport');assert.equal(updated.translations.en.description,'en: Trip details');
  assert.equal(updated.smart.short_titles.ru,'Уход за волосами');
  await page.evaluate(async()=>{tab='settings';page='main';await loadData();await openSettingsSection('events')});
  for(const [width,language,theme] of [[320,'ru','light'],[390,'en','dark'],[430,'ru','dark']]){
   await page.setViewportSize({width,height:844});await page.evaluate(async({language,theme})=>{state=await api('settings','PATCH',{language,theme});render()},{language,theme});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
  }
  await page.evaluate(async id=>openEvent(id),id);await page.locator('#smart-event-excluded').check();await page.waitForFunction(()=>currentEvent.smart?.excluded===true);
  assert.equal(await page.locator('.description-card').count(),0);
  if(process.env.CALENDAR_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,'smart-detail.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('Smart Events mobile acceptance passed: background/manual concurrency, partial form edits, unified titles in 7 views, title switch, live account states, auto mode, RU/EN and 320/390/430 px.');
 }finally{if(browser)await browser.close();server.kill();rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});

