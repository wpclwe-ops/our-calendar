// Synthetic local UI acceptance; no API key or external calendar access.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-smart-'));
 const env={...process.env,DEMO_MODE:'true',OPENAI_API_KEY:'',AUTO_SETUP_BOT:'false',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'8011'};
 const seeded=spawnSync('python',['-m','scripts.demo_seed'],{env});assert.equal(seeded.status,0,seeded.stderr?.toString());
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
  await page.locator('.smart-dialog button[type=submit]').click();await page.waitForSelector('.smart-dialog',{state:'detached'});
  const saved=await page.evaluate(async id=>api('events/'+id),id);assert.equal(saved.smart.short_titles.ru,'Мой салон');assert.equal(saved.title,'Corner Salon: Tonowanie');
  await page.evaluate(async()=>{tab='settings';page='main';await loadData();render()});await page.locator('[data-action=smart-open]').click();await page.waitForSelector('[data-smart-pref=consent]');
  assert.ok((await page.locator('#app').textContent()).includes('OpenAI'));
  assert.equal(await page.locator('.smart-rule').count(),1);
  await page.locator('[data-smart-pref=display_short]').uncheck();await page.waitForFunction(()=>state.me.smart_events?.display_short===false);
  await page.locator('[data-smart-pref=consent]').check();await page.waitForFunction(()=>state.me.smart_events?.consent===true);
  for(const [width,language,theme] of [[320,'ru','light'],[390,'en','dark'],[430,'ru','dark']]){
   await page.setViewportSize({width,height:844});await page.evaluate(async({language,theme})=>{state=await api('settings','PATCH',{language,theme});render()},{language,theme});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
  }
  await page.evaluate(async id=>openEvent(id),id);await page.locator('#smart-event-excluded').check();await page.waitForFunction(()=>currentEvent.smart?.excluded===true);
  assert.equal(await page.locator('.description-card').count(),0);
  if(process.env.CALENDAR_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,'smart-detail.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('Smart Events mobile acceptance passed: title-only details, RU/EN, manual short titles, scoped rules, settings, exclusion, 320/390/430 px.');
 }finally{if(browser)await browser.close();server.kill();rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
