// Integration checks on a temporary synthetic database; no production access.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-interactions-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'archive-key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'archive-public-keys.json'),PORT:'8003'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
 await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
 await page.clock.install({time:new Date('2026-10-16T20:30:00Z')});await page.goto('http://127.0.0.1:8003');
 await page.waitForSelector('.timeline');const cdp=await context.newCDPSession(page);
 const wait=async()=>{await page.waitForFunction(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active()&&!monthLoading);await page.waitForTimeout(30)};
 const set=async(date,mode)=>{await page.evaluate(async({date,mode})=>{selected=date;await changeView(mode)},{date,mode});await wait()};
 async function hold(x,y,endY=y){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await page.waitForTimeout(540);
  if(endY!==y){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:endY}]});await page.waitForTimeout(80)}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait();await page.waitForTimeout(700);
 }
 const back=async()=>{await page.locator('[data-action="back"]').first().click();await wait()};

 const info=()=>page.evaluate(()=>({tab,view,selected,page}));
 async function swipe(x1,x2,y=430,cancel=false){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y}]});
  for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/10,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await wait();
 }
 async function toolbar(items){await page.evaluate(async items=>{state=await api('settings','PATCH',{touch_bar:items});render()},items);await wait()}
 await toolbar(['month','day','settings']);await set('2026-10-16','month');
 await swipe(325,60);assert.equal((await info()).view,'day');assert.equal((await info()).selected,'2026-10-16');
 await swipe(325,60);assert.equal((await info()).tab,'settings');assert.equal(await page.locator('.bottom-nav [aria-current="page"]').textContent(),'Настройки');
 // Settings scrolls natively; a short horizontal swipe does not change tabs or dates.
 const before=await info();await swipe(250,175,670);assert.deepEqual(await info(),before);
 await page.locator('.navigation-content').evaluate(el=>el.scrollTop=120);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:680}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:185,y:500}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait();
 assert.ok(await page.locator('.navigation-content').evaluate(el=>el.scrollTop)>120);
 const scrollTop=await page.locator('.navigation-content').evaluate(el=>el.scrollTop);await page.evaluate(()=>render());assert.equal(await page.locator('.navigation-content').evaluate(el=>el.scrollTop),scrollTop);
 await page.locator('.navigation-content').evaluate(el=>el.scrollTop=0);
 await swipe(325,60,670);assert.equal((await info()).tab,'settings');
 await swipe(60,325,670);assert.equal((await info()).tab,'calendar');assert.equal((await info()).view,'day');
 await swipe(60,325);assert.equal((await info()).view,'month');await swipe(60,325);assert.equal((await info()).view,'month');
 // Changing the order immediately changes swipes; categories participate as a tab.
 await toolbar(['day','categories','month','settings']);await set('2026-10-16','day');
 await swipe(325,60);assert.equal((await info()).tab,'categories');assert.ok(await page.locator('.category-card').count()>0);
 await swipe(325,60,650);assert.equal((await info()).tab,'calendar');assert.equal((await info()).view,'month');
 await swipe(60,325);assert.equal((await info()).tab,'categories');await swipe(60,325,650);assert.equal((await info()).view,'day');
 await swipe(250,175);assert.equal((await info()).selected,'2026-10-17');assert.equal((await info()).view,'day');
 await swipe(325,60,430,true);assert.equal((await info()).view,'day');assert.equal(await page.locator('.motion-preview').count(),0);
 // A failed tab data request cancels the transition and leaves the old view usable.
 await toolbar(['day','settings']);await page.evaluate(()=>navigationCache.clear());
 await page.route('**/api/system-status',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"error"}'}));
 await swipe(325,60);assert.equal((await info()).tab,'calendar');assert.equal((await info()).view,'day');assert.equal(await page.locator('.motion-preview').count(),0);await page.unroute('**/api/system-status');
 // The toolbar occupies no layout strip. Empty space passes through to each calendar view.
 await toolbar(['day','week','month','settings']);
 for(const mode of ['day','week','month']){
  await set('2026-10-16',mode);
  const actionsBox=await page.locator('.calendar-actions').boundingBox();
  assert.ok(await page.evaluate(y=>Boolean(document.elementFromPoint(10,y)?.closest('.timeline,.agenda,.month,.month-scroll,.day-checklist')),actionsBox.y+20),mode+' extends under actions');
  assert.equal(await page.locator('.calendar-actions').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('.calendar-actions').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  assert.equal(await page.locator('.calendar-motion-viewport').evaluate(el=>getComputedStyle(el).marginBottom),'0px');
 }
 await page.evaluate(async()=>{state=await api('settings','PATCH',{day_layout:'list',month_layout:'scroll'});await loadData();render()});await wait();await set('2026-10-16','day');
 let actionsBox=await page.locator('.calendar-actions').boundingBox();assert.ok(await page.evaluate(y=>Boolean(document.elementFromPoint(10,y)?.closest('.day-checklist')),actionsBox.y+20));
 await set('2026-10-16','month');actionsBox=await page.locator('.calendar-actions').boundingBox();assert.ok(await page.evaluate(y=>Boolean(document.elementFromPoint(10,y)?.closest('.month-scroll')),actionsBox.y+20));
 // The actual buttons remain clickable, and light/dark preserve visible outlines.
 await page.evaluate(()=>$('#toast').style.display='none');
 for(const theme of ['light','dark']){await page.evaluate(theme=>{state.me.theme=theme;render()},theme);await wait();
  assert.equal(await page.locator('.calendar-actions .fab').evaluate(el=>getComputedStyle(el).borderTopWidth),'1px');
  if(process.env.CALENDAR_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,'transparent-actions-'+theme+'.png')});
 }
 if(process.env.CALENDAR_SCREENSHOT_DIR){await page.evaluate(async()=>{state=await api('settings','PATCH',{day_layout:'timeline',theme:'dark'});view='day';await loadData();render()});await wait();await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,'transparent-timeline-dark.png')});await set('2026-10-16','month');}
 await page.locator('[data-action="today"]').tap();await wait();assert.equal((await info()).selected,'2026-10-16');await page.locator('[data-action="new"]').tap();await wait();assert.equal((await info()).page,'form');await back();
 await page.emulateMedia({reducedMotion:'reduce'});await set('2026-10-16','month');await swipe(325,60);assert.equal((await info()).tab,'settings');await swipe(60,325,650);assert.equal((await info()).view,'month');
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 assert.deepEqual(errors,[]);console.log('PASS: personal-order tab swipes, hidden views, categories/settings both ways, native settings scroll, short date swipes, cancellation/failure rollback/reduced motion, transparent pass-through action area in all calendar views and outlined working buttons');
 }finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
