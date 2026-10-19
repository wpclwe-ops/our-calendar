// PF-2: the calendar toolbar stays in place while only the calendar body slides; navigation keeps the live nodes.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-fixed-toolbar-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'archive-key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'archive-public-keys.json'),PORT:'8025'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
 await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
 await page.goto('http://127.0.0.1:8025');await page.waitForSelector('.calendar-controls');
 const cdp=await context.newCDPSession(page);
 const idle=async()=>{for(let i=0;i<300;i++){if(await page.evaluate(()=>!busy&&!calendarSwipe.active()&&!document.querySelector('.motion-preview')))return;await page.waitForTimeout(20)}throw new Error('navigation did not settle')};
 const touch=(type,x,y=520)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
 async function swipe(x1,x2){await touch('touchStart',x1);for(let i=1;i<=10;i++){await touch('touchMove',x1+(x2-x1)*i/10);await page.waitForTimeout(16)}await touch('touchEnd');await idle();await page.waitForTimeout(520)}
 const set=async(date,mode)=>{await page.evaluate(async({date,mode})=>{selected=date;await changeView(mode)},{date,mode});await idle()};
 const mark=()=>page.evaluate(()=>{for(const [name,selector] of [['bar','.calendar-shell > .calendar-controls'],['header','#app header.header'],['nav','#app .bottom-nav'],['actions','#app .calendar-actions']])document.querySelector(selector).__fixedMark=name});
 const snapshot=()=>page.evaluate(()=>{
  const bar=document.querySelector('.calendar-controls');
  return {selected,view,
   bar:bar?.__fixedMark||null,barCount:document.querySelectorAll('.calendar-controls').length,inViewport:Boolean(bar?.closest('.calendar-motion-viewport')),barView:bar?.dataset.view,
   heading:bar?.querySelector('.month-title').textContent,subtitle:bar?.querySelector('.calendar-heading small').textContent,toggle:bar?.querySelector('.layout-toggle').dataset.action,
   header:document.querySelector('#app header.header')?.__fixedMark||null,nav:document.querySelector('#app .bottom-nav')?.__fixedMark||null,actions:document.querySelector('#app .calendar-actions')?.__fixedMark||null,tab,
   active:document.querySelector('.bottom-nav .active')?.dataset.view||null,pages:document.querySelectorAll('.calendar-motion-page').length,
   live:(p=>p&&!p.inert&&!p.hasAttribute('aria-hidden')&&!p.classList.contains('motion-preview')&&p.dataset.view)(document.querySelector('.calendar-motion-page'))};
 });
 const kept=(s,expect)=>{
  assert.deepEqual([s.bar,s.header,s.nav,s.actions],['bar','header','nav','actions'],'toolbar, header, bottom nav and actions stay the same nodes');
  assert.equal(s.barCount,1);assert.equal(s.inViewport,false,'toolbar is outside the motion viewport');assert.equal(s.pages,1);assert.equal(s.live,s.view,'the arrived page is live and interactive');
  assert.equal(s.barView,s.view);assert.equal(s.active,s.view);for(const [k,v] of Object.entries(expect))v instanceof RegExp?assert.match(s[k],v,k):assert.equal(s[k],v,k);
 };
 await page.evaluate(async()=>{state=await api('settings','PATCH',{touch_bar:['day','week','month','settings'],week_layout:'agenda',day_layout:'timeline',month_layout:'paged'});render()});
 await page.evaluate(()=>api('events','POST',{title:'Toolbar specimen',start:'2026-10-17T12:00',end:'2026-10-17T13:00',timezone:'UTC'}));

 // Week: arrow, then swipe. The toolbar does not move during the drag; only the calendar does.
 await set('2026-10-16','week');await mark();
 assert.equal((await snapshot()).heading,'3-я неделя октября');
 await page.locator('[data-action=next]').tap();await idle();
 kept(await snapshot(),{selected:'2026-10-23',heading:'4-я неделя октября',subtitle:/19–25 октября 2026/,toggle:'week-layout'});
 const barBox=await page.locator('.calendar-controls').boundingBox();
 await touch('touchStart',300);for(const x of [270,230,190])await touch('touchMove',x);await page.waitForTimeout(80);
 const during=await page.evaluate(()=>({bar:getComputedStyle(document.querySelector('.calendar-controls')).transform,page:getComputedStyle(document.querySelector('.calendar-motion-page:not(.motion-preview)')).transform,preview:Boolean(document.querySelector('.motion-preview .calendar-controls'))}));
 assert.equal(during.bar,'none');assert.notEqual(during.page,'none','the calendar body follows the finger');assert.equal(during.preview,false,'the incoming page carries no second toolbar');
 assert.deepEqual(await page.locator('.calendar-controls').boundingBox(),barBox);
 await touch('touchEnd');await idle();await page.waitForTimeout(520);
 kept(await snapshot(),{selected:'2026-10-30',heading:'5-я неделя октября'});

 // Day: arrow and swipe update the date in place; the arrived page's events still open.
 await set('2026-10-16','day');await mark();
 await page.locator('[data-action=next]').tap();await idle();
 kept(await snapshot(),{selected:'2026-10-17',heading:'17 октября',subtitle:/суббота/i,toggle:'day-layout'});
 await page.locator('.time-event',{hasText:'Toolbar specimen'}).tap();await idle();assert.equal(await page.evaluate(()=>page),'detail');
 await page.locator('[data-action="back"]').first().tap();await idle();await mark();
 await swipe(250,150);kept(await snapshot(),{selected:'2026-10-18',heading:'18 октября',subtitle:/воскресенье/i});
 await swipe(150,250);kept(await snapshot(),{selected:'2026-10-17',heading:'17 октября'});

 // Month: arrow and swipe.
 await set('2026-10-16','month');await mark();
 await page.locator('[data-action=next]').tap();await idle();
 kept(await snapshot(),{selected:'2026-11-16',heading:/ноябр/i,subtitle:'2026',toggle:'month-layout'});
 await swipe(250,150);kept(await snapshot(),{selected:'2026-12-16',heading:/декабр/i});
 assert.equal(await page.locator('.month-agenda').count(),1);

 // A long swipe changes the view under the same toolbar, including its layout button and the bottom nav.
 await swipe(20,380);kept(await snapshot(),{view:'week',selected:'2026-12-16',heading:'3-я неделя декабря',toggle:'week-layout'});
 await swipe(20,380);kept(await snapshot(),{view:'day',selected:'2026-12-16',heading:'16 декабря',toggle:'day-layout'});
 // Today and the layout toggle still work on the kept page.
 await page.locator('.today-btn').tap();await idle();assert.equal(await page.evaluate(()=>selected===isoDay()&&view==='day'),true);
 await page.locator('.layout-toggle').tap();await idle();assert.equal(await page.evaluate(()=>state.me.day_layout),'list');assert.equal(await page.locator('.day-checklist').count(),1);

 // Leaving for another tab takes the toolbar along; coming back restores it outside the viewport.
 await set('2026-10-16','month');
 await swipe(380,20);assert.equal(await page.evaluate(()=>tab),'settings');assert.equal(await page.locator('.calendar-controls').count(),0);
 await swipe(20,380);const back=await snapshot();assert.equal(await page.evaluate(()=>tab),'calendar');assert.equal(back.view,'month');assert.equal(back.barCount,1);assert.equal(back.inViewport,false);
 // A cancelled long swipe towards a tab puts the toolbar back where it was.
 await touch('touchStart',380);for(let i=1;i<=10;i++)await touch('touchMove',380-36*i);await page.waitForTimeout(80);
 assert.equal(await page.evaluate(()=>Boolean(document.querySelector('.calendar-motion-page:not(.motion-preview) > .calendar-controls'))),true);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await idle();
 const cancelled=await snapshot();assert.equal(cancelled.inViewport,false);assert.equal(cancelled.barCount,1);assert.equal(await page.evaluate(()=>tab),'calendar');
 assert.deepEqual(errors,[]);
 console.log('fixed calendar toolbar ok');
 }finally{await browser?.close();server.kill();rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exit(1)});
