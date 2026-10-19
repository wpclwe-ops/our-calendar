// Browser regression: prev/next keeps the timeline's time of day; entering a view or Today re-positions it.
// Synthetic demo database only. Polls with evaluate because the CSP blocks waitForFunction.
const {chromium}=require('playwright'),{spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict'),{mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-timeline-scroll-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'8026'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const context=await browser.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
  await page.clock.install({time:new Date('2026-10-18T12:30:00Z')});await page.goto('http://127.0.0.1:8026');await page.waitForSelector('.timeline');
  const idle=async()=>{for(let i=0;i<100;i++){if(await page.evaluate(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active()&&!document.querySelector('.motion-preview')))break;await page.waitForTimeout(50)}await page.waitForTimeout(150)};
  const top=()=>page.locator('.timeline').evaluate(e=>e.scrollTop),date=()=>page.evaluate(()=>selected);
  const cdp=await context.newCDPSession(page);
  async function swipe(x1,x2,y=430){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y}]});
   for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/10,y}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await idle();
  }
  // Sample every attached incoming page at each frame: it must never show scrollTop 0.
  const watch=()=>page.evaluate(()=>{window.__tops=[];const tick=()=>{document.querySelectorAll('.calendar-motion-page .timeline').forEach(e=>{if(e.clientHeight)window.__tops.push(e.scrollTop)});window.__raf=requestAnimationFrame(tick)};tick()});
  const unwatch=()=>page.evaluate(()=>{cancelAnimationFrame(window.__raf);return window.__tops});
  const near=(v,w=700)=>assert.ok(Math.abs(v-w)<=4,`scrollTop ${v} not near ${w}`);
  const steady=tops=>assert.ok(tops.length>0&&tops.every(v=>Math.abs(v-700)<=4),'incoming page sampled at '+JSON.stringify([...new Set(tops)]));
  await page.evaluate(async()=>{state=await api('settings','PATCH',{touch_bar:['day','month','week','categories','settings'],timezone:'Europe/Warsaw'});selected='2026-10-18';await changeView('week')});await idle();
  await page.locator('[data-action="week-layout"]').click();await page.locator('.week-layout-sheet [data-layout="three"]').click();await idle();
  assert.equal(await page.locator('.timeline-day').count(),3);
  const scrollTo=async v=>{await page.locator('.timeline').evaluate((e,v)=>e.scrollTop=v,v);await page.waitForTimeout(100);near(await top(),v)};
  // Week: arrow, arrow back, then swipes in both directions.
  await scrollTo(700);let d=await date();await watch();await page.locator('[data-action="next"]').click();await idle();
  assert.notEqual(await date(),d);near(await top());steady(await unwatch());
  await page.locator('[data-action="prev"]').click();await idle();near(await top());
  d=await date();await watch();await swipe(250,175);assert.notEqual(await date(),d);near(await top());steady(await unwatch());
  await swipe(150,225);assert.equal(await date(),d);near(await top());
  // Today re-positions to now rather than the carried offset.
  await scrollTo(100);await page.locator('[data-action="next"]').click();await idle();near(await top(),100);
  await page.locator('[data-action="today"]').click();await idle();
  const expected=await page.evaluate(()=>{const n=CalendarTime.local(new Date(),tz());return Math.max(0,(Number(n.slice(11,13))*60+Number(n.slice(14,16)))/60*70-document.querySelector('.timeline').clientHeight*.25)});
  assert.ok(Math.abs(await top()-expected)<=4,`Today scrollTop ${await top()} expected ${expected}`);
  // Day timeline.
  await page.evaluate(async()=>{selected='2026-10-18';await changeView('day')});await idle();assert.equal(await page.locator('.timeline[data-date]').count(),1);
  await scrollTo(700);d=await date();await page.locator('[data-action="next"]').click();await idle();assert.notEqual(await date(),d);near(await top());
  await page.locator('[data-action="prev"]').click();await idle();near(await top());
  await watch();await swipe(250,175);assert.notEqual(await date(),d);near(await top());steady(await unwatch());
  assert.deepEqual(errors,[]);
  console.log('browser timeline scroll ok');
 }finally{await browser?.close();server.kill();rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
