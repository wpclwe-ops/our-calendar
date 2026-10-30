// Approved event surfaces, genuine API round trips, synthetic identities and database.
const {chromium}=require('playwright'),{spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict'),{mkdtempSync,rmSync,mkdirSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const dir=mkdtempSync(join(tmpdir(),'calendar-surface-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(dir,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(dir,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(dir,'keys.json'),PORT:'8033'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','ignore','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.once('exit',c=>reject(Error('server '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'America/Los_Angeles'});
  const errors=[],writes=[],translationCalls=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()!=='GET'&&/\/api\/events/.test(r.url()))writes.push({url:r.url(),body:r.postDataJSON()})});
  await page.route('https://telegram.org/**',r=>r.abort());await page.clock.install({time:new Date('2026-10-31T17:00:00Z')});
  await page.goto('http://127.0.0.1:8033');await page.waitForSelector('.fab');
  const idle=()=>page.waitForFunction(()=>!busy);
  const shot=async name=>{if(process.env.CALENDAR_SCREENSHOT_DIR){mkdirSync(process.env.CALENDAR_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,name+'.png'),fullPage:true})}};
  await page.evaluate(async()=>{warmNavigation=()=>{};state=await api('settings','PATCH',{timezone:'Europe/Warsaw',theme:'light',language:'ru'});newEvent('2026-10-31',1140)});
  await page.locator('[name=title]').fill('Dinner specimen');await page.locator('[name=location]').fill('Synthetic venue');await page.locator('[name=description]').fill('An evening together.');
  assert.equal(await page.locator('#event-form input[type=checkbox][name=all_day]').count(),0);
  assert.equal(await page.locator('.surface-notifications input:visible').count(),0);
  await page.locator('[data-action=form-reminders]').click();await idle();
  let sheet=page.locator('.event-reminder-sheet');
  await sheet.locator('[data-reminder-check=none]').check();
  for(const n of [30,60,1440,0])await sheet.locator(`[data-reminder-check="${n}"]`).check();
  await sheet.locator('[data-reminder-check="15"]').click();assert.equal(await sheet.locator('[data-reminder-check="15"]').isChecked(),false);assert.ok(await sheet.locator('.error').textContent());
  await sheet.locator('[type=submit]').click();await idle();assert.equal(writes.length,0,'form reminders remain a local draft');
  assert.deepEqual(await page.evaluate(()=>formEvent.reminders[state.me.id]),[30,60,1440,0]);
  await page.locator('[data-action=form-reminders]').click();await idle();await sheet.locator('[data-reminder-check=none]').check();await sheet.locator('[data-close]').click();
  assert.deepEqual(await page.evaluate(()=>formEvent.reminders[state.me.id]),[30,60,1440,0],'cancel discards reminder choices');
  await page.locator('[name=repeat]').selectOption('WEEKLY');await idle();await page.locator('[name=repeat-end]').selectOption('count');await idle();await page.locator('[name=repeat-count]').fill('3');
  await page.locator('.surface-manual summary').click();await page.locator('[name=title_en]').fill('Manual English title');await page.locator('[name=description_en]').fill('Manual English description');
  await page.locator('[data-action=form-translation-language][data-lang=ru]').click();await idle();await page.locator('[name=title_ru]').fill('Ручное название');
  await page.evaluate(()=>{cfg.integrations.translation='configured';captureForm();render()});
  await page.route('**/api/events/*/translate',r=>{translationCalls.push(r.request().postDataJSON());return r.fulfill({json:{queued:true}})});
  await page.locator('[data-action=form-retranslate]').click();await idle();await page.locator('[data-queue-translation]').click();assert.ok(await page.locator('.surface-modal .error').textContent());assert.equal(translationCalls.length,0);
  await page.locator('[data-overwrite-manual]').check();await page.locator('[data-queue-translation]').click();assert.equal(translationCalls.length,0,'translation is scheduled after save');
  await shot('editor-light');
  await page.locator('.header-save').click();await idle();await page.waitForSelector('.detail-title');
  let created=await page.evaluate(()=>currentEvent);
  assert.equal(created.location,'Synthetic venue');assert.match(created.rrule,/FREQ=WEEKLY/);assert.match(created.rrule,/COUNT=3/);
  assert.deepEqual(created.reminders['1'],[1440,60,30]);assert.deepEqual(created.reminders['2'],[60]);assert.equal(created.reminder_at_start['1'],true);
  assert.equal(created.translations.en.title,'Manual English title');assert.equal(created.translations.ru.title,'Ручное название');assert.deepEqual(translationCalls,[{overwrite_manual:true}]);
  assert.equal(await page.locator('.detail-actions button').count(),2);await shot('detail-light');
  const baseWrites=writes.length;await page.locator('[data-action=edit-reminders]').click();await idle();await sheet.locator('[data-reminder-check=none]').check();await sheet.locator('[data-reminder-check="120"]').check();await sheet.locator('[type=submit]').click();await idle();
  assert.equal(writes.length,baseWrites+1);assert.match(writes.at(-1).url,/\/occurrence$/);assert.deepEqual(Object.keys(writes.at(-1).body.changes).sort(),['reminders','reminders_v2']);
  assert.deepEqual((await page.evaluate(()=>currentEvent)).reminders['2'],[60]);
  // All-day range has an inclusive visible end, with exclusive storage and no zone shift.
  await page.evaluate(()=>newEvent('2026-10-31',1140));await page.locator('[name=title]').fill('All-day specimen');
  const openDate=async()=>{await page.locator('[data-action=event-datetime]').click();await idle()};
  await openDate();let date=page.locator('.event-datetime-picker');
  assert.ok(await date.evaluate(el=>el.querySelector('[data-ed-all-day]').getBoundingClientRect().bottom<el.querySelector('.ed-tabs').getBoundingClientRect().top));
  await date.locator('[data-ed-all-day]').check();await date.locator('[data-ed-cancel]').click();assert.equal(await page.evaluate(()=>formEvent.all_day),false);
  await openDate();await date.locator('[data-ed-all-day]').check();assert.equal(await date.locator('.ed-time').isVisible(),false);
  await date.locator('[data-ed-tab=end]').click();await date.locator('[data-ed-date-toggle]').click();await date.locator('[data-ed-day-choice="2026-11-01"]').click();await date.locator('[data-ed-done]').click();await idle();
  assert.equal(await page.inputValue('[name=start]'),'2026-10-31');assert.equal(await page.inputValue('[name=end]'),'2026-11-02');assert.match(await page.locator('.surface-date').textContent(),/1/);
  await page.locator('.header-save').click();await idle();created=await page.evaluate(()=>currentEvent);assert.equal(created.all_day,true);assert.equal(created.start,'2026-10-31');assert.equal(created.end,'2026-11-02');
  await page.locator('[data-action=edit-event]').click();await idle();await openDate();assert.equal(await date.locator('[data-ed-all-day]').isChecked(),true);await date.locator('[data-ed-cancel]').click();await page.locator('.header-save').click();await idle();assert.equal((await page.evaluate(()=>currentEvent)).end,'2026-11-02','unchanged edit does not grow the range');
  for(const language of ['ru','en'])for(const theme of ['light','dark'])for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});await page.evaluate(({language,theme})=>{state.me.language=language;state.me.theme=theme;render()},{language,theme});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot(`detail-${language}-${theme}-${width}`);
   await page.locator('[data-action=edit-event]').click();await idle();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('[data-action=form-reminders]').click();await idle();
   assert.ok(await page.locator('.surface-modal').evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight}));
   await page.keyboard.press('Escape');await page.locator('[data-action=back]').first().click();await idle();
  }
  assert.deepEqual(errors,[]);console.log('PASS: event surfaces, checkbox drafts/cancel/limits, personal occurrence reminder patch, recurrence, manual RU/EN, retranslation consent, all-day range, both languages/themes and 320/390/430px');
 }finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
