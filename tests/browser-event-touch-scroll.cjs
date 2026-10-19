// Real touch sequences starting on an event: scroll, swipe, tap and long-press drag. Temporary synthetic database only.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-event-touch-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'archive-key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'archive-public-keys.json'),PORT:'8027'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
 await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
 await page.clock.install({time:new Date('2026-10-16T20:30:00Z')});await page.goto('http://127.0.0.1:8027');
 await page.waitForSelector('.timeline');const cdp=await context.newCDPSession(page);
 // No waitForFunction: the CSP forbids unsafe-eval, so poll through evaluate instead.
 const wait=async()=>{for(let i=0;i<100;i++){if(await page.evaluate(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active()&&!monthLoading))break;await page.waitForTimeout(30)}await page.waitForTimeout(60)};
 const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
 const info=()=>page.evaluate(()=>({view,selected,page}));
 const scrollTop=()=>page.locator('.timeline').evaluate(el=>el.scrollTop);
 const ev=await page.evaluate(async()=>{const category=await api('categories','POST',{name:'Touch test',color:'#D77777'});return api('events','POST',{title:'Touch specimen',start:'2026-10-16T09:00',end:'2026-10-16T12:00',timezone:'Europe/Warsaw',owner:'both',category_id:category.id})});
 await page.evaluate(async()=>{state=await api('settings','PATCH',{day_layout:'timeline'});selected='2026-10-16';await changeView('day')});await wait();
 const resetScroll=async()=>{await page.locator('.timeline').evaluate(el=>el.scrollTop=8*70);await page.waitForTimeout(60)};
 const eventBox=async()=>{const box=await page.locator(`.time-event[data-id="${ev.id}"]`).boundingBox();assert.ok(box&&box.height>150);return box};
 assert.equal(await page.locator(`.time-event[data-id="${ev.id}"]`).evaluate(el=>getComputedStyle(el).touchAction),'pan-y');
 // A vertical drag that starts on the event scrolls the timeline.
 await resetScroll();let box=await eventBox(),x=box.x+box.width/2,y=box.y+box.height-30,start=await scrollTop();
 await touch('touchStart',x,y);for(let i=1;i<=10;i++){await touch('touchMove',x,y-20*i);await page.waitForTimeout(16)}await touch('touchEnd');await wait();
 assert.ok(await scrollTop()>start+100,'drag on event should scroll, scrollTop '+start+' -> '+await scrollTop());
 assert.equal((await info()).page,'main');assert.equal((await page.evaluate(id=>api('events/'+id),ev.id)).start,'2026-10-16T09:00');
 // Scrolling before the hold fires cancels the hold: pausing afterwards does not arm a drag.
 await resetScroll();box=await eventBox();x=box.x+box.width/2;y=box.y+box.height-30;
 await touch('touchStart',x,y);for(let i=1;i<=5;i++){await touch('touchMove',x,y-20*i);await page.waitForTimeout(16)}await page.waitForTimeout(600);
 assert.equal(await page.evaluate(()=>document.body.classList.contains('calendar-holding')),false);await touch('touchEnd');await wait();
 assert.equal((await page.evaluate(id=>api('events/'+id),ev.id)).start,'2026-10-16T09:00');
 // A horizontal swipe that starts on the event moves to the next day.
 await resetScroll();box=await eventBox();x=box.x+box.width/2;y=box.y+60;
 await touch('touchStart',x+120,y);for(let i=1;i<=10;i++)await touch('touchMove',x+120-24*i,y);await touch('touchEnd');await wait();
 assert.equal((await info()).selected,'2026-10-17');assert.equal((await info()).page,'main');
 await page.evaluate(async()=>{selected='2026-10-16';await changeView('day')});await wait();
 // A tap on the event still opens it, and the swipe handling does not swallow it.
 await resetScroll();box=await eventBox();await touch('touchStart',box.x+box.width/2,box.y+60);await page.waitForTimeout(60);await touch('touchEnd');await wait();
 await page.waitForSelector('.detail-title');assert.equal(await page.locator('.detail-title').textContent(),'Touch specimen');
 await page.locator('[data-action="back"]').first().click();await wait();
 // Long press then drag still moves the event, without scrolling or swiping the timeline.
 await page.evaluate(async()=>{selected='2026-10-16';await changeView('day')});await wait();await resetScroll();
 box=await eventBox();x=box.x+box.width/2;y=box.y+12;start=await scrollTop();
 await touch('touchStart',x,y);await page.waitForTimeout(540);
 assert.equal(await page.evaluate(()=>document.body.classList.contains('calendar-holding')),true);
 for(let i=1;i<=7;i++){await touch('touchMove',x+(i%2?4:-4),y+10*i);await page.waitForTimeout(30)}
 assert.equal(await scrollTop(),start,'timeline must not scroll while dragging an event');
 await touch('touchEnd');await wait();await page.waitForTimeout(700);
 const moved=await page.evaluate(id=>api('events/'+id),ev.id);assert.equal(moved.start,'2026-10-16T10:00');assert.equal(moved.end,'2026-10-16T13:00');
 assert.equal((await info()).selected,'2026-10-16');assert.equal((await info()).page,'main');
 assert.deepEqual(errors,[]);console.log('PASS: scroll, swipe, tap and long-press drag all work when the touch starts on an event');
 }finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
