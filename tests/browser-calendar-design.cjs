// Approved calendar layouts on synthetic data only; never connects to production.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync,mkdirSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-design-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'archive-key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'archive-public-keys.json'),PORT:'8004'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
 await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
 await page.clock.install({time:new Date('2026-10-17T12:00:00Z')});await page.goto('http://127.0.0.1:8004');await page.waitForSelector('.timeline');
 const wait=()=>page.waitForFunction(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active()&&!monthLoading);
 const screenshot=async name=>{if(process.env.CALENDAR_SCREENSHOT_DIR){mkdirSync(process.env.CALENDAR_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,name+'.png')})}};
 await page.evaluate(async()=>{state=await api('settings','PATCH',{theme:'dark',day_layout:'list'});for(const e of new Map((await api('events?start=2026-10-01&end=2026-11-01')).map(e=>[e.id,e])).values())await api('events/'+e.id,'DELETE',{revision:e.revision,confirmed:true});const c=await api('categories','POST',{name:'Calendar design',color:'#9B77D1'});for(let i=0;i<7;i++)await api('events','POST',{title:i===0?'Выставка «Цвет и свет»':'Задача '+(i+1),start:`2026-10-17T${String(10+i).padStart(2,'0')}:00`,end:`2026-10-17T${String(10+i).padStart(2,'0')}:30`,timezone:'Europe/Warsaw',category_id:c.id,owner:'both'});await loadData();render()});await wait();
 assert.equal(await page.locator('.month-title').textContent(),'Сегодня');assert.equal(await page.locator('.day-layout-row').count(),0);
 const toggle=page.locator('.layout-toggle');const listIcon=await toggle.innerHTML();assert.equal(await toggle.getAttribute('aria-pressed'),'true');
 await screenshot('day-list-dark');await toggle.click();await wait();assert.equal(await toggle.innerHTML(),listIcon);assert.equal(await toggle.getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('.time-event').first().evaluate(el=>getComputedStyle(el).borderLeftWidth),'0px');
 for(const block of await page.locator('.time-event').all())assert.ok(Math.abs(Number(await block.getAttribute('data-height'))-35)<.01);
 await page.locator('.timeline').evaluate(el=>el.scrollTop=9*70);await screenshot('day-timeline-dark');
 // Separate filter menu, combined owner/category/status filtering, Cancel, and reset.
 await page.locator('[data-action=filters]').click();await page.waitForSelector('.filter-sheet');assert.equal(await page.locator('.filter-sheet select').count(),3);
 await page.locator('.filter-sheet [name=filter-status]').selectOption('done');await page.locator('.filter-sheet [data-close]').click();assert.equal(await page.evaluate(()=>filter.status),'');
 await page.locator('[data-action=filters]').click();await page.locator('.filter-sheet [name=filter-status]').selectOption('done');await page.locator('.filter-sheet [type=submit]').click();await wait();assert.equal(await page.locator('.time-event').count(),0);
 await page.locator('[data-action=filters]').click();await page.locator('.filter-sheet [data-reset]').click();await page.locator('.filter-sheet [type=submit]').click();await wait();
 await page.evaluate(async()=>{selected='2026-10-17';await changeView('month')});await wait();
 assert.equal(await page.locator('.month-with-agenda .day').count(),35);assert.equal(await page.locator('.month-agenda .day-task').count(),7);
 const monthBox=await page.locator('.month').boundingBox();await page.locator('.month-agenda').evaluate(el=>el.scrollTop=200);assert.equal((await page.locator('.month').boundingBox()).y,monthBox.y);
 assert.ok(await page.locator('.month-agenda').evaluate(el=>el.scrollTop)>0);await page.evaluate(()=>render());assert.ok(await page.locator('.month-agenda').evaluate(el=>el.scrollTop)>0);
 await page.locator('.day[data-date="2026-10-18"]').click();await wait();assert.equal(await page.evaluate(()=>view),'month');assert.equal(await page.locator('.month-agenda .day-task').count(),0);
 await page.locator('[data-action=today]').click();await wait();await page.locator('.month-agenda').evaluate(el=>el.scrollTop=0);await screenshot('month-full-dark');
 await page.locator('[data-action=month-layout]').click();await wait();assert.equal(await page.locator('.month-agenda').count(),0);
 assert.equal(await page.locator('.month-scroll .day[data-date="2026-10-17"] .event-bar').count(),5);assert.equal(await page.locator('.month-scroll .day[data-date="2026-10-17"] .more').textContent(),'+2');
 const dates=await page.locator('.month-scroll .day').evaluateAll(els=>els.map(el=>el.dataset.date));assert.equal(new Set(dates).size,dates.length);
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});await page.waitForTimeout(80);assert.ok(await page.locator('.month-scroll').evaluate(el=>Math.abs(el.clientHeight/2-el.querySelector('.scroll-week').offsetHeight)<2));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.locator('.month-scroll .day[data-date="2026-10-17"]').evaluate(el=>{const chip=el.querySelectorAll('.event-bar')[4];return chip.getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom&&el.querySelector('.more').getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom}),'five tasks and overflow fit within date');await screenshot('month-scroll-dark-'+width)}
 await page.locator('.month-scroll .day[data-date="2026-10-17"] .more').click();await wait();assert.equal(await page.locator('.month-agenda .day-task').count(),7);
 await page.locator('.month-agenda [data-action=event]').first().click();await page.waitForSelector('.detail-title');assert.ok((await page.locator('.detail-title').textContent()).length>0);
 await page.locator('[data-action=back]').first().click();await wait();
 await page.evaluate(async()=>{selected='2026-10-17';await changeView('week')});await wait();assert.equal(await page.locator('.layout-toggle').count(),0);assert.equal(await page.locator('.week-date').count(),7);await screenshot('week-dark');
 await page.evaluate(()=>{state.me.theme='light';render()});await screenshot('week-light');
 await page.reload();await page.waitForSelector('.timeline');assert.equal(await page.evaluate(()=>state.me.day_layout),'timeline');assert.equal(await page.evaluate(()=>state.me.month_layout),'paged');
 assert.deepEqual(errors,[]);console.log('PASS: day/list toggle with constant icon, exact timeline duration, filter dialog apply/cancel/reset, full month and independently scrolling selected-day list, 2-week scrolling grid with 5 tasks/date and overflow, details, mode persistence, responsive mobile dark/light.');
 }finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
