// Integration checks on a temporary synthetic database; no production access.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-interactions-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'archive-key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'archive-public-keys.json'),PORT:'8002'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
 await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
 await page.clock.install({time:new Date('2026-10-16T20:30:00Z')});await page.goto('http://127.0.0.1:8002');
 await page.waitForSelector('.timeline');const cdp=await context.newCDPSession(page);
 const wait=async()=>{await page.waitForFunction(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active()&&!monthLoading);await page.waitForTimeout(30)};
 const set=async(date,mode)=>{await page.evaluate(async({date,mode})=>{selected=date;await changeView(mode)},{date,mode});await wait()};
 async function hold(x,y,endY=y){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await page.waitForTimeout(540);
  if(endY!==y){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:endY}]});await page.waitForTimeout(80)}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait();await page.waitForTimeout(700);
 }
 const back=async()=>{await page.locator('[data-action="back"]').first().click();await wait()};
 // Personal toolbar: add/remove, fixed Settings, buttons and real-touch reorder.
 await page.locator('.bottom-nav [data-tab="settings"]').click();await wait();
 await page.locator('[data-action="touchbar"]').click();await wait();
 assert.ok(await page.locator('[name="touchbar-item"][value="settings"]').isDisabled());
 await page.locator('[name="touchbar-item"][value="week"]').check();await wait();
 await page.locator('[name="touchbar-item"][value="categories"]').check();await wait();
 assert.deepEqual(await page.evaluate(()=>state.me.touch_bar),['day','month','week','categories','settings']);
 await page.locator('[data-action="touchbar-move"][data-item="week"][data-direction="-1"]').click();await wait();
 assert.deepEqual(await page.evaluate(()=>state.me.touch_bar),['day','week','month','categories','settings']);
 const handle=await page.locator('[data-drag="month"]').boundingBox(),target=await page.locator('.touchbar-row[data-item="day"]').boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:handle.x+15,y:handle.y+20}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:handle.x+15,y:target.y+5}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait();
 assert.deepEqual(await page.evaluate(()=>state.me.touch_bar),['month','day','week','categories','settings']);
 await page.locator('[name="touchbar-item"][value="categories"]').uncheck();await wait();await back();
 assert.deepEqual(await page.locator('.bottom-nav button').allTextContents(),['Месяц','День','Неделя','Настройки']);
 await page.locator('[data-tab="categories"]').click();await wait();assert.equal(await page.evaluate(()=>tab),'categories');
 await page.locator('.bottom-nav [data-view="week"]').click();await wait();assert.equal(await page.evaluate(()=>view),'week');
 await page.locator('.bottom-nav [data-view="day"]').click();await wait();
 await set('2026-11-20','day');await page.locator('[data-action="today"]').click();await wait();assert.equal(await page.evaluate(()=>selected),'2026-10-16');assert.equal(await page.evaluate(()=>view),'day');
 assert.ok((await page.locator('[data-action="today"]').boundingBox()).x<(await page.locator('[data-action="new"]').boundingBox()).x);
 await set('2026-11-20','month');await page.locator('[data-action="today"]').click();await wait();assert.equal(await page.evaluate(()=>selected),'2026-10-16');assert.equal(await page.evaluate(()=>view),'month');
 assert.equal(await page.locator('.day[data-date="2026-10-16"]').evaluate(el=>getComputedStyle(el).borderRightWidth),'0px');
 await page.locator('.bottom-nav [data-view="day"]').click();await wait();
 await page.locator('.bottom-nav [data-tab="settings"]').click();await wait();
 await page.selectOption('[name="setting-month_layout"]','scroll');await wait();
 await page.locator('.bottom-nav [data-view="month"]').click();await wait();
 // Today in scrolling month returns to its week and does not switch views.
 await set('2027-01-20','month');await page.locator('[data-action="today"]').click();await wait();await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>selected),'2026-10-16');assert.equal(await page.evaluate(()=>view),'month');
 const todayCell=await page.locator('.day[data-date="2026-10-16"]').boundingBox(),monthViewport=await page.locator('.month-scroll').boundingBox();
 assert.ok(todayCell.y>=monthViewport.y&&todayCell.y+todayCell.height<=monthViewport.y+monthViewport.height+1);
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});await page.waitForTimeout(100);assert.ok(await page.locator('.month-scroll').evaluate(el=>Math.abs(el.clientHeight/2-el.querySelector('.scroll-week').offsetHeight)<2));}
 if(process.env.CALENDAR_SCREENSHOT_DIR){await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,'two-weeks-light.png')});await page.evaluate(()=>{state.me.theme='dark';render()});await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,'two-weeks-dark.png')});}

 await page.reload();await page.waitForSelector('.timeline');assert.deepEqual(await page.evaluate(()=>state.me.touch_bar),['month','day','week','settings']);
 await page.selectOption('#demo-user','2');await wait();assert.deepEqual(await page.evaluate(()=>state.me.touch_bar),['day','month','settings']);
 assert.deepEqual(errors,[]);console.log('PASS: personal toolbar add/remove, fixed Settings, arrow and real-touch reorder, categories in settings, persisted user-specific order, Today retains day/week/month, two continuous week rows in light/dark at 320/390/430px');
 }finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
