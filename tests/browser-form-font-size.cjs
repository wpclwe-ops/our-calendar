// Computed font/layout regression in Chromium touch emulation; real iPhone focus zoom needs device acceptance.
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const {withDemo,openPage}=require('./helpers/browser-fixture.cjs');

(async()=>{
 for(const width of [320,390,402,430])await withDemo(async({browser,url})=>{
 const {page,context,errors}=await openPage(browser,url);
 const ready=()=>page.waitForFunction(()=>!busy);
 const check=async label=>{
  const result=await page.evaluate(()=>({
   small:[...document.querySelectorAll('input,select,textarea')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&!['checkbox','radio','hidden','range','color'].includes(el.type)).filter(el=>parseFloat(getComputedStyle(el).fontSize)<16).map(el=>(el.name||el.id||el.tagName)+': '+getComputedStyle(el).fontSize),
   overflow:document.documentElement.scrollWidth>innerWidth,
   outside:[...document.querySelectorAll('input,select,textarea')].filter(el=>el.getClientRects().length).filter(el=>{const box=el.getBoundingClientRect();return box.left<-.5||box.right>innerWidth+.5}).map(el=>el.name||el.id||el.type),
  }));
  assert.deepEqual(result.small,[],label+' computed fonts');assert.equal(result.overflow,false,label+' horizontal overflow');assert.deepEqual(result.outside,[],label+' field bounds');
 };
 const snapshot=async name=>{if(process.env.CALENDAR_SCREENSHOT_DIR){mkdirSync(process.env.CALENDAR_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,name+'.png')})}};
 for(const language of ['ru','en'])for(const theme of ['light','dark']){
  const label=`${width}/${language}/${theme}`;
  await page.setViewportSize({width,height:874});
  await page.evaluate(async({language,theme})=>{state=await api('settings','PATCH',{language,theme,timezone_mode:'manual'});newEvent('2026-11-03',600)},{language,theme});
  await check(label+' event');
  assert.ok(await page.locator('[name=title]').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>16),'large event title');
  await page.locator('.translation-fields summary').click();await page.locator('.dst-fields summary').click();await check(label+' translations/DST');
  for(const repeat of ['WEEKLY','MONTHLY','YEARLY']){
   await page.selectOption('[name=repeat]',repeat);
   if(repeat==='MONTHLY')await page.selectOption('[name=repeat-month-mode]','ordinal');
   await page.selectOption('[name=repeat-end]','count');await check(label+' '+repeat+' count');
   await page.selectOption('[name=repeat-end]','date');await check(label+' '+repeat+' until');
  }
  await page.locator('[data-reminder-preset]').first().selectOption('custom');await check(label+' custom reminder');
  await page.locator('[name=all_day]').check();await check(label+' all-day');
  if(width===402&&language==='ru')await snapshot('all-day-'+theme+'-402');
  await page.evaluate(()=>{tab='settings';page='main';settingsSection='';render()});
  const sections=await page.locator('[data-action=settings-open]').evaluateAll(elements=>elements.map(el=>el.dataset.section));
  for(const section of sections){
   await ready();await page.locator(`[data-action=settings-open][data-section="${section}"]`).click();await ready();await page.waitForSelector('.settings-section');
   if(section==='events'){
    await page.selectOption('[name=duration-preset]','custom');await check(label+' custom duration');
    await page.locator('[data-action=settings-default-notifications]').click();await page.locator('.modal details summary').click();await check(label+' default reminders dialog');
    await page.locator('.modal [data-close]').click();
   }
   await check(label+' settings '+section);
   if(section==='language'&&width===402&&language==='ru')await snapshot('language-'+theme+'-402');
   await page.locator('[data-action=settings-back]').click();await ready();await page.waitForSelector('.settings-menu');
  }
  // Actual category dialog, including HEX and RU/EN fields.
  await page.evaluate(()=>categoryDialog());await check(label+' category dialog');await page.locator('#close-category').click();
  await page.evaluate(async()=>{const event=await api('events','POST',{title:'Dialog regression',start:'2026-11-03T10:00',end:'2026-11-03T11:00',rrule:'FREQ=DAILY;COUNT=2',reminders:[45]});await openEvent(event.id)});
  await ready();await page.locator('[data-action=edit-reminders]').click();await ready();await check(label+' event reminders dialog');await page.locator('.modal [data-close]').first().click();
  await ready();await page.locator('[data-action=other-occurrences]').click();await ready();await check(label+' occurrence month dialog');await page.locator('.modal [data-close]').click();
  await page.evaluate(()=>smartEditDialog());await check(label+' smart title dialog');await page.locator('.modal [data-close]').click();
  const viewport=await page.locator('meta[name=viewport]').getAttribute('content');assert.ok(!/maximum-scale|user-scalable\s*=\s*(no|0)/i.test(viewport),'user zoom remains enabled');
  console.log('PASS: '+label);
 }
 assert.deepEqual(errors,[]);await context.close();
 const desktop=await openPage(browser,url,{isMobile:false,hasTouch:false,viewport:{width:1024,height:900}});
 await desktop.page.evaluate(()=>newEvent('2026-11-03',600));
 assert.equal(await desktop.page.locator('[name=start]').evaluate(el=>getComputedStyle(el).fontSize),'14px','mouse layout unchanged');
 assert.ok(await desktop.page.locator('[name=title]').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>16));
 assert.deepEqual(desktop.errors,[]);await desktop.context.close();
 });
 console.log('PASS: computed fonts >=16px and no horizontal overflow; large titles, event/recurrence/translations/custom reminders, all settings, category/reminder/occurrence/smart dialogs; RU/EN × light/dark × 320/390/402/430px; desktop and pinch-zoom policy preserved.');
})().catch(error=>{console.error(error);process.exitCode=1});
