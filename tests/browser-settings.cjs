// Real UI/API acceptance with synthetic accounts, no external API keys.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const expectedVersion=readFileSync(join(__dirname,'../pyproject.toml'),'utf8').match(/^version\s*=\s*"([^"]+)"/m)[1];
(async()=>{
 const dir=mkdtempSync(join(tmpdir(),'calendar-settings-'));
 const env={...process.env,DEMO_MODE:'true',OPENAI_API_KEY:'',AUTO_SETUP_BOT:'false',DATABASE_PATH:join(dir,'db.sqlite3'),ARCHIVE_KEY_FILE:join(dir,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(dir,'keys.json'),PORT:'8022'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(Error('server exit '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
  await page.goto('http://127.0.0.1:8022');await page.waitForSelector('.fab');
  const originalDesign=await page.locator('.bottom-nav').evaluate(el=>({background:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius}));
  await page.locator('.bottom-nav [data-tab=settings]').click();await page.waitForSelector('.settings-menu');
  const order=await page.locator('.settings-menu [data-action=settings-open]').evaluateAll(nodes=>nodes.map(x=>x.dataset.section));
  assert.deepEqual(order,['pair','appearance','language','views','events','connections','data','service','advanced']);
  assert.equal(await page.locator('.settings-menu [data-action=settings-open] small').count(),9);
  assert.deepEqual(await page.locator('.settings-menu button').evaluateAll(nodes=>nodes.slice(-2).map(x=>x.dataset.action)),['leave','approve-deletion']);
  const open=async section=>{await page.locator(`[data-action=settings-open][data-section=${section}]`).click();await page.waitForSelector('.settings-section');};
  const back=async()=>{await page.locator('[data-action=settings-back]').click();await page.waitForSelector('.settings-menu');};
  await open('pair');
  assert.equal(await page.locator('input[name=partner-name]').count(),0);
  await page.locator('[name=own-name]').fill('Synthetic owner');await page.locator('[name=own-gender]').selectOption('female');await page.locator('#own-profile-form button[type=submit]').click();
  await page.waitForFunction(()=>state.me.name==='Synthetic owner');
  await page.locator('[name=pair-name]').fill('Synthetic pair');await page.locator('[name=relationship-started]').fill('2025-02-01');
  await page.locator('#pair-avatar-file').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBTEAAAAASUVORK5CYII=','base64')});
  await page.waitForFunction(()=>pairAvatarDraft.startsWith('data:image/png;base64,'));
  await page.locator('#pair-profile-form button[type=submit]').click();await page.waitForFunction(()=>state.calendar.profile?.name==='Synthetic pair');
  const partnerBefore=await page.evaluate(async()=>{const auth=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({demo_user:'2'})}).then(r=>r.json());return auth.state.me.name});
  assert.notEqual(partnerBefore,'Synthetic owner');
  await back();await open('appearance');await page.locator('[data-personal-pref=reduce_transparency]').check();await page.waitForFunction(()=>document.body.classList.contains('reduce-transparency'));
  await page.locator('[data-personal-pref=reduce_transparency]').uncheck();await page.waitForFunction(()=>!document.body.classList.contains('reduce-transparency'));
  await back();assert.deepEqual(await page.locator('.bottom-nav').evaluate(el=>({background:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius})),originalDesign);
  await open('language');await page.locator('[data-personal-pref=timezone_mode]').selectOption('auto');await page.waitForFunction(()=>state.me.timezone_mode==='auto'&&state.me.timezone==='Europe/Warsaw');
  await back();await open('views');await page.locator('[data-action=settings-view][data-key=week_layout]').click();
  assert.equal(await page.locator('.settings-view-mini').count(),3);
  await page.locator('[data-action=settings-view-choose][data-value=seven]').click();await page.waitForFunction(()=>state.me.week_layout==='seven');await page.waitForSelector('.modal-backdrop',{state:'detached'});
  await back();await open('events');
  assert.equal(await page.locator('[name=setting-notify_at_start],.delivery-row').count(),0);
  await page.locator('[data-personal-pref=notifications_enabled]').uncheck();await page.waitForFunction(()=>state.me.notifications_enabled===false);
  await page.locator('[data-personal-pref=notifications_enabled]').check();await page.waitForFunction(()=>state.me.notifications_enabled===true);
  await page.locator('[data-action=settings-default-notifications]').click();
  for(const value of await page.locator('[data-notification-choices] input:checked').evaluateAll(inputs=>inputs.map(x=>x.value)))await page.locator(`[data-notification-choices] input[value="${value}"]`).uncheck();
  await page.locator('[data-notification-choices] input[value="0"]').check();
  await page.locator('.modal details summary').click();await page.locator('.modal [name=amount]').fill('45');await page.locator('[data-add-custom]').click();
  assert.equal(await page.locator('[data-notification-choices] input:checked').count(),2);
  assert.ok(await page.locator('[data-notification-choices] input[value="60"]').isDisabled());
  await page.locator('.modal button[type=submit]').click();await page.waitForFunction(()=>state.me.default_notifications.includes(45)&&state.me.default_notifications.includes(0));
  await page.evaluate(async()=>{const e=await api('events','POST',{title:'Remembered example','start':'2026-10-24T12:00','end':'2026-10-24T13:00'});await api('events/'+e.id+'/smart','PATCH',{revision:e.revision,short_titles:{ru:'Example correction'},remember:true})});
  await back();await open('advanced');assert.equal(await page.locator('[data-personal-pref=budget]').count(),0);assert.ok((await page.locator('.settings-section').textContent()).includes('не ограничивает'));
  await page.locator('[data-action=settings-open][data-section=memory]').click();await page.waitForSelector('.smart-rule');
  await page.locator('[data-action=settings-clear-memory]').click();await page.locator('[data-choice=yes]').click();await page.waitForSelector('.smart-rule',{state:'detached'});
  await page.locator('[data-action=settings-back]').click();await page.locator('[data-action=settings-back]').click();await open('service');assert.ok((await page.locator('.settings-section').textContent()).includes(expectedVersion));
  for(const [width,language] of [[320,'ru'],[390,'en'],[430,'ru']]){
   await page.setViewportSize({width,height:844});await page.evaluate(async language=>{state=await api('settings','PATCH',{language});tab='settings';page='main';render()},language);
   const alignment=await page.evaluate(()=>{
    const card=document.querySelector('.settings-menu .form-group').getBoundingClientRect(),nav=document.querySelector('.bottom-nav').getBoundingClientRect();
    return {left:Math.abs(card.left-nav.left),right:Math.abs(card.right-nav.right)};
   });
   assert.ok(alignment.left<1&&alignment.right<1,'settings groups align with navigation at '+width+': '+JSON.stringify(alignment));
   for(const section of order){await open(section);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'settings overflow '+section+' '+width);await back();}
  }
  assert.deepEqual(errors,[]);console.log('PASS: settings navigation, descriptions, own identity isolation, shared avatar/date, two/custom/start defaults, view previews, personal toggles, memory clear, RU/EN widths, unchanged default navigation style');
 }finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});

