const {chromium}=require('playwright'),{spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict'),{mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-google-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'8001',PYTHONPATH:'.'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['tests/google_browser_server.py'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
  await page.goto('http://127.0.0.1:8001');await page.waitForSelector('.timeline');
  const wait=async()=>{await page.waitForFunction(()=>!busy);await page.waitForTimeout(50)};
  await page.locator('.bottom-nav [data-tab="settings"]').click();await wait();
  await page.locator('[data-section=connections]').click();await wait();
  await page.locator('[data-action="google-open"]').click();await wait();assert.equal(await page.locator('.g-account').count(),1);
  await page.locator('[data-action="google-calendars"]').click();await wait();assert.equal(await page.locator('.g-source').count(),1);
  await page.locator('.g-source').check();await page.locator('[data-action="google-save-sources"]').click();await wait();
  if(!await page.locator('[data-action="google-events"]').count()) {
   const diagnostic=await page.evaluate(()=>({step:googleUI.step,sources:googleUI.status?.accounts?.[0]?.sources,busy}));
   throw new Error('Google source selection not visible: '+JSON.stringify({diagnostic,errors,toast:await page.locator('#toast').textContent(),view:(await page.locator('#app').textContent()).slice(-800)}));
  }
  await page.locator('[data-action="google-events"]').click();await wait();
  assert.equal(await page.locator('.g-event').count(),4);assert.equal(await page.locator('.g-event:disabled').count(),1);
  assert.equal(await page.locator('.g-event:checked').count(),0);
  // Both Back controls return to this account's calendar selection.
  for(const selector of ['[data-action="google-events-back"]','.header-back[data-action="back"]']){
   await page.locator(selector).click();await wait();
   assert.equal(await page.locator('.g-source').count(),1);
   assert.equal(await page.locator('.g-event').count(),0);
   await page.locator('[data-action="google-save-sources"]').click();await wait();
   await page.locator('[data-action="google-events"]').click();await wait();
   assert.equal(await page.locator('.g-event').count(),4);
  }
  if(process.env.GOOGLE_SCREENSHOT)await page.screenshot({path:process.env.GOOGLE_SCREENSHOT,fullPage:true});
  await page.locator('.g-event[value="visit"]').check();await page.locator('[data-action="google-preview"]').click();await wait();
  assert.ok(await page.locator('#app').textContent().then(v=>v.includes('Dentist')));
  assert.ok(!(await page.locator('#app').textContent()).includes('Never share this'));
  // A failed import leaves the preview and retry intact.
  await page.route('**/api/google/import',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"google_delayed"}'}));
  await page.locator('[data-action="google-import"]').click();await wait();assert.equal(await page.locator('[data-action="google-import"]').count(),1);
  await page.unroute('**/api/google/import');await page.locator('[data-action="google-import"]').click();await wait();
  assert.equal(await page.locator('.g-link').count(),1);
  // Reimport uses the same event. Both participants see only the explicitly selected event.
  await page.locator('[data-action="google-events"]').click();await wait();await page.locator('.g-event[value="visit"]').check();
  await page.locator('[data-action="google-preview"]').click();await wait();assert.ok((await page.locator('#app').textContent()).includes('Уже добавлено'));
  await page.locator('[data-action="google-import"]').click();await wait();assert.equal(await page.locator('.g-link').count(),1);
  await page.locator('[data-action="google-sync"]').click();await wait();
  const shared=await page.evaluate(async()=>{const a=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({demo_user:'2'})}).then(r=>r.json());const h={Authorization:'Bearer '+a.token};return {status:await fetch('/api/google',{headers:h}).then(r=>r.json()),events:await fetch('/api/events?start=2026-10-01&end=2026-11-01',{headers:h}).then(r=>r.json())}});
  assert.equal(shared.status.accounts.length,0);assert.equal(shared.events.filter(e=>e.title==='Dentist').length,1);assert.ok(!shared.events.some(e=>e.title==='Never share this'));
  // Legacy Google imports have HTML in source/translated descriptions.
  // They must be displayed as inert readable text, with paragraph spacing kept.
  const readable=await page.evaluate(()=>[
    readableGoogleDescription('<p>Flight &amp; hotel<br>New line</p>'),
    readableGoogleDescription('&lt;p&gt;Семинар &amp;amp; контакт&lt;/p&gt;'),
    readableGoogleDescription('<p>First</p><p>Second</p>'),
    readableGoogleDescription('<p>Safe<img src=x onerror=alert(1)></p>'),
    readableGoogleDescription('1 < 2, ordinary note'),
    readableGoogleDescription('<p>Love &lt;3 today</p>')
  ]);
  assert.deepEqual(readable,[
    'Flight & hotel\nNew line','Семинар & контакт','First\n\nSecond','Safe','1 < 2, ordinary note','Love <3 today'
  ]);
  for(const [width,language,theme] of [[320,'ru','light'],[390,'en','dark'],[430,'ru','dark']]){
   await page.setViewportSize({width,height:844});await page.evaluate(async({language,theme})=>{state=await api('settings','PATCH',{language,theme});render()},{language,theme});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  // Automatic sharing must require a separate explicit confirmation.
  await page.locator('[data-action="google-calendars"]').click();await wait();
  await page.locator('.g-auto').check();
  await page.locator('[data-action="google-save-sources"]').click();
  await page.locator('.modal [data-choice="yes"]').click();await wait();
  assert.ok((await page.locator('#app').textContent()).includes('Автоматический импорт включён'));
  await page.locator('[data-action="google-sync"]').click();await wait();
  assert.ok(await page.locator('.g-link').count()>=3);
  const allShared=await page.evaluate(async()=>{const a=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({demo_user:'2'})}).then(r=>r.json());return fetch('/api/events?start=2026-10-01&end=2026-11-01',{headers:{Authorization:'Bearer '+a.token}}).then(r=>r.json())});
  assert.ok(allShared.some(e=>e.title==='Never share this'));
  // A temporary/server problem keeps the normal controls and shows retry timing.
  const savedStatus=await page.evaluate(()=>JSON.parse(JSON.stringify(googleUI.status)));
  for(const source of savedStatus.accounts[0].sources){source.state='delayed';source.last_error='credential_storage';source.checked_at='2026-10-20T10:00:00Z';source.next_at='2026-10-20T12:05:00Z'}
  await page.route('**/api/google',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(savedStatus)}));
  await page.evaluate(()=>refreshGoogleStatus());
  assert.ok((await page.locator('#app').textContent()).includes('Последняя успешная синхронизация'));
  assert.ok((await page.locator('#app').textContent()).includes('Следующая попытка'));
  assert.ok((await page.locator('#app').textContent()).includes('Сервер не смог прочитать'));
  assert.equal(await page.locator('[data-action="google-calendars"]').count(),1);
  await page.unroute('**/api/google');
  // The same diagnostics and retained controls apply to iCloud, in both languages.
  const appleStatus={configured:true,accounts:[{id:'apple',email:'synthetic@example.com',state:'connected',sources:[{id:'source',name:'Personal',selected:1,auto_import:1,state:'recovering',checked_at:'2026-10-20T10:00:00Z',next_at:'2026-10-20T12:05:00Z',last_error:'',linked_count:1,issues:[]}]}]};
  await page.route('**/api/icloud',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(appleStatus)}));
  await page.evaluate(()=>openICloudImports());
  assert.ok((await page.locator('#app').textContent()).includes('Проверяем доступ'));
  assert.equal(await page.locator('[data-action="icloud-calendars"]').count(),1);
  assert.equal(await page.locator('[data-action="icloud-sync"]').count(),1);
  await page.evaluate(()=>{state.me.language='en';render()});
  assert.ok((await page.locator('#app').textContent()).includes('Checking access'));
  assert.ok((await page.locator('#app').textContent()).includes('Last successful sync'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);console.log('Google import mobile acceptance passed: manual privacy, consent-gated auto import, preview, retry, deduplication, RU/EN and mobile viewports.');
 }finally{if(browser)await browser.close();server.kill();rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});


