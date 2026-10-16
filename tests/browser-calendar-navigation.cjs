// Optional browser regression: install Playwright and Chromium, then run from repo root.
// Uses a fresh synthetic demo database; never connects to production.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-swipe-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'archive-key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'archive-public-keys.json'),PORT:'8000'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});
 let browser;
 try{
 await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});const page=await context.newPage();await page.route('https://telegram.org/**',r=>r.abort());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8000');await page.waitForSelector('.calendar-view-row');
 const cdp=await context.newCDPSession(page);
 const wait=()=>page.waitForFunction(()=>!busy);
 const info=()=>page.evaluate(()=>({selected,view,page,query}));
 async function swipe(x1,x2,y=430,dy=0){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y}]});
  for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/10,y:y+dy*i/10}]});
  const hint=await page.locator('.calendar-swipe-hint').count()?await page.locator('.calendar-swipe-hint').textContent():null;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait();await page.waitForTimeout(50);await wait();return hint;
 }
 async function set(date,mode){await page.evaluate(async({date,mode})=>{selected=date;await changeView(mode)},{date,mode});await wait()}
 await set('2026-10-16','month');
 await swipe(250,175);assert.deepEqual(await info(),{selected:'2026-11-16',view:'month',page:'main',query:''});
 await swipe(150,225);assert.equal((await info()).selected,'2026-10-16');
 const h=await swipe(325,60);assert.match(h,/Неделя/);assert.equal((await info()).view,'week');assert.equal((await info()).selected,'2026-10-16');
 assert.equal(await page.locator('.month-title').textContent(),'3-я неделя октября');assert.match(await page.locator('.week-range').textContent(),/12–18 октября 2026/);
 if(process.env.CALENDAR_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,'calendar-week.png')});
 await swipe(250,175);assert.equal((await info()).selected,'2026-10-23');assert.equal((await info()).view,'week');
 await swipe(150,225);assert.equal((await info()).selected,'2026-10-16');
 await swipe(325,60);assert.equal((await info()).view,'day');assert.equal((await info()).selected,'2026-10-16');
 await swipe(250,175);assert.equal((await info()).selected,'2026-10-17');
 await swipe(150,225);assert.equal((await info()).selected,'2026-10-16');
 const scrollBefore=await page.locator('.timeline').evaluate(el=>el.scrollTop);
 await swipe(200,205,550,-150);assert.equal((await info()).selected,'2026-10-16');assert.equal((await info()).view,'day');
 assert.ok(await page.locator('.timeline').evaluate(el=>el.scrollTop)>scrollBefore,'native vertical scrolling');
 await swipe(325,60);assert.equal((await info()).view,'day');assert.equal((await info()).selected,'2026-10-16');
 await swipe(60,325);assert.equal((await info()).view,'week');
 await swipe(60,325);assert.equal((await info()).view,'month');
 await swipe(60,325);assert.equal((await info()).view,'month');assert.equal((await info()).selected,'2026-10-16');
 // A cancelled gesture must not move, and its hint must disappear.
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:320,y:430}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:80,y:430}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await wait();assert.equal((await info()).view,'month');assert.equal(await page.locator('.calendar-swipe-hint').count(),0);
 await page.waitForTimeout(510);await page.locator('[data-action="date"][data-date="2026-10-16"] .day-number').tap();await wait();assert.equal((await info()).view,'day');
 // Search and other tabs do not respond to gestures.
 await page.locator('[data-action="search"]').tap();await wait();await page.locator('#search').blur();await swipe(325,60);assert.equal((await info()).view,'day');assert.equal((await info()).selected,'2026-10-16');
 await page.locator('[data-action="search"]').tap();await wait();await page.locator('[data-action="tab"][data-tab="categories"]').tap();await wait();await swipe(325,60);assert.equal((await info()).view,'day');
 await page.locator('[data-action="tab"][data-tab="calendar"]').tap();await wait();await set('2027-01-01','week');assert.match(await page.locator('.week-range').textContent(),/2026.*2027/);
 for(const width of [320,375,430]){await page.setViewportSize({width,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 // Checklist uses its own scroll container, and event taps still open details.
 await page.setViewportSize({width:375,height:812});await set('2026-10-16','day');await page.evaluate(()=>{state.me.day_layout='list';render()});await swipe(250,175);assert.equal((await info()).selected,'2026-10-17');await swipe(150,225);assert.equal((await info()).selected,'2026-10-16');
 // Pinch/multitouch cancels navigation.
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y:500,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y:500,id:1},{x:200,y:500,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal((await info()).selected,'2026-10-16');
 await page.waitForTimeout(510);await page.locator('.day-task-card').first().tap();await wait();assert.equal((await info()).page,'detail');await page.locator('[data-action="back"]').first().tap();await wait();await set('2026-10-16','week');
 // English heading and dark theme render with the same range.
 await page.evaluate(()=>{state.me.language='en';state.me.theme='dark';selected='2026-10-16';render()});assert.equal(await page.locator('.month-title').textContent(),'Week 3 of October');if(process.env.CALENDAR_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,'calendar-week-dark.png')});
 assert.deepEqual(errors,[]);console.log('PASS: real touch short/long swipes in all views, selection, hint, native vertical scroll, cancelled gesture, tap, search/tab isolation, month/year boundaries, 320/375/430px, EN/dark; no page errors');
 }finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
