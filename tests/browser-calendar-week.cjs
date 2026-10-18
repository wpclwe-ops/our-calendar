// Synthetic calendar only. New week layouts retain the application's controls.
const {chromium}=require('playwright'),{spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict'),{mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-week-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'8001'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
  await page.clock.install({time:new Date('2026-10-18T12:30:00Z')});await page.goto('http://127.0.0.1:8001');await page.waitForSelector('.timeline');
  const wait=async()=>{await page.waitForFunction(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active());await page.waitForTimeout(40)};
  const fixtures=await page.evaluate(async()=>{
   state=await api('settings','PATCH',{touch_bar:['day','month','week','categories','settings'],timezone:'Europe/Warsaw'});
   const category=await api('categories','POST',{name:'Week specimen',color:'#D47AAE'});
   const make=(title,start,end,extra={})=>api('events','POST',{title,start,end,timezone:'Europe/Warsaw',owner:'both',category_id:category.id,...extra});
   const sunday=await make('Sunday appointment','2026-10-18T10:00','2026-10-18T11:00');
   await make('Friday appointment','2026-10-16T18:00','2026-10-16T19:00');
   await make('Friday overlap','2026-10-16T18:30','2026-10-16T19:30');
   await make('Night appointment','2026-10-16T23:30','2026-10-17T01:00');
   await make('All-day specimen','2026-10-17','2026-10-19',{all_day:true});
   await make('Short appointment','2026-10-18T15:00','2026-10-18T15:05');
   selected='2026-10-18';await changeView('week');return {sunday,category};
  });await wait();
  assert.equal(await page.locator('.week-strip .week-date').count(),7);
  const nav=await page.locator('.bottom-nav').innerHTML();
  const choose=async layout=>{await page.locator('[data-action="week-layout"]').click();await page.locator(`.week-layout-sheet [data-layout="${layout}"]`).click();await wait()};
  await choose('three');assert.equal(await page.locator('.timeline-day').count(),3);
  assert.deepEqual(await page.locator('.timeline-day').evaluateAll(es=>es.map(e=>e.dataset.date)),['2026-10-16','2026-10-17','2026-10-18']);
  assert.equal(await page.locator('.bottom-nav').innerHTML(),nav);
  assert.equal(await page.locator('.week-timeline .now-line').count(),1);
  assert.equal(await page.locator('.now-line').getAttribute('data-date'),'2026-10-18');
  assert.equal(await page.locator('.week-all-event').count(),2);
  for(const action of ['search','filters','week-layout','prev','next','today','new'])assert.equal(await page.locator(`[data-action="${action}"]`).count(),1);
  const icon3=await page.locator('[data-action="week-layout"] svg').innerHTML();
  await page.locator('.timeline').evaluate(e=>e.scrollTop=630);await page.evaluate(()=>render());assert.equal(await page.locator('.timeline').evaluate(e=>e.scrollTop),630);
  // Grid columns align exactly with date headers; events stay inside their day.
  const geometry=await page.evaluate(()=>[...document.querySelectorAll('.timeline-day')].map((col,i)=>{
   const a=col.getBoundingClientRect(),b=document.querySelectorAll('.week-timeline-header .week-date')[i].getBoundingClientRect();
   return {aligned:Math.abs(a.x-b.x)<1&&Math.abs(a.width-b.width)<1,fits:[...col.querySelectorAll('.time-event')].every(e=>{const r=e.getBoundingClientRect();return r.x>=a.x&&r.right<=a.right+1})};
  }));assert.ok(geometry.every(x=>x.aligned&&x.fits));
  // Opening a time block still opens the full event details.
  await page.locator(`.time-event[data-id="${fixtures.sunday.id}"]`).click();await wait();assert.equal(await page.locator('.detail-title').textContent(),'Sunday appointment');
  await page.locator('[data-action="back"]').first().click();await wait();
  // Drag a Sunday block while Friday is selected: its date must remain Sunday.
  await page.evaluate(()=>{selected='2026-10-16';render();document.querySelector('.timeline').scrollTop=630});await wait();
  const cdp=await context.newCDPSession(page);
  async function hold(x,y,endY=y){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await page.waitForTimeout(540);
   if(endY!==y){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:endY}]});await page.waitForTimeout(100)}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait();await page.waitForTimeout(700);
  }
  let box=await page.locator(`.time-event[data-id="${fixtures.sunday.id}"]`).boundingBox();await hold(box.x+box.width/2,box.y+12,box.y+82);
  const moved=await page.evaluate(id=>api('events/'+id),fixtures.sunday.id);assert.equal(moved.start,'2026-10-18T11:00');assert.equal(moved.end,'2026-10-18T12:00');
  const sat=await page.locator('.timeline-day[data-date="2026-10-17"]').boundingBox(),area=await page.locator('.timeline').boundingBox();
  await hold(sat.x+sat.width/2,area.y+140);assert.equal((await page.inputValue('[name="start"]')).slice(0,10),'2026-10-17');
  await page.locator('[data-action="back"]').first().click();await wait();
  // Failed persistence leaves the original layout and the picker available.
  await page.route('**/api/settings',r=>r.request().method()==='PATCH'?r.fulfill({status:500,contentType:'application/json',body:'{"error":"test_failure"}'}):r.continue(),{times:1});
  await choose('seven');assert.equal(await page.locator('.week-layout-sheet').count(),1);assert.equal(await page.locator('.timeline-day').count(),3);
  await page.locator('.week-layout-sheet [data-layout="seven"]').click();await wait();assert.equal(await page.locator('.timeline-day').count(),7);
  assert.notEqual(await page.locator('[data-action="week-layout"] svg').innerHTML(),icon3);
  assert.equal(await page.locator('.bottom-nav').innerHTML(),nav);
  // Each arrow still moves a full week, even in the three-day layout.
  await page.locator('[data-action="next"]').click();await wait();assert.equal(await page.evaluate(()=>selected),'2026-10-23');
  await page.locator('[data-action="today"]').click();await wait();assert.equal(await page.evaluate(()=>selected),'2026-10-18');assert.equal(await page.locator('.timeline-day').count(),7);
  await page.evaluate(()=>{document.querySelector('#toast').style.display='none'});
  // Empty timeline columns keep short period swipes and long Touch Bar swipes.
  const swipe=async distance=>{
   const a=await page.locator('.timeline').boundingBox(),x=distance>0?30:page.viewportSize().width-30,y=a.y+Math.min(130,a.height/2);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+distance*i/6,y}]});await page.waitForTimeout(12)}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait();await page.waitForTimeout(700);
  };
  await page.locator('.timeline').evaluate(el=>el.scrollTop=0);await swipe(-100);assert.equal(await page.evaluate(()=>selected),'2026-10-25');
  await page.locator('[data-action="today"]').click();await wait();await page.locator('.timeline').evaluate(el=>el.scrollTop=0);
  await swipe(-280);assert.equal(await page.evaluate(()=>tab),'categories');
  await page.locator('.bottom-nav [data-view="week"]').click();await wait();
  // Match the existing palette and fit narrow/short screens, in RU and EN.
  for(const language of ['ru','en'])for(const theme of ['light','dark'])for(const width of [320,390,430]){
   await page.setViewportSize({width,height:width===320?640:844});
   await page.evaluate(async({language,theme})=>{state=await api('settings','PATCH',{language,theme});render()},{language,theme});
   for(const layout of ['three','seven']){
    await page.evaluate(async layout=>{await changeWeekLayout(layout);document.querySelector('.timeline').scrollTop=630},layout);await wait();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.ok((await page.locator('.timeline').boundingBox()).height>100);
    const controls=await page.locator('.calendar-tools').boundingBox();assert.ok(controls.x+controls.width<=width);
    if(process.env.CALENDAR_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,`week-${layout}-${language}-${theme}-${width}.png`)});
   }
  }
  // Search and filters continue to use the existing flows.
  await page.locator('[data-action="filters"]').click();await page.selectOption('[name="filter-category"]',fixtures.category.id);await page.locator('.filter-sheet [type="submit"]').click();await wait();
  assert.ok(await page.locator('.time-event').count()>0);
  await page.locator('[data-action="search"]').click();await page.locator('#search').fill('Sunday appointment');await page.waitForTimeout(600);await wait();assert.ok(await page.locator('.search-event-group .event').count()>0);
  await page.locator('[data-action="clear-search"]').click();await wait();await page.locator('[data-action="search"]').click();await wait();
  await choose('agenda');assert.equal(await page.locator('.week-strip .week-date').count(),7);assert.equal(await page.locator('.timeline-day').count(),0);
  await choose('seven');await page.reload();await page.waitForSelector('.timeline');assert.equal(await page.evaluate(()=>view),'day');assert.equal(await page.evaluate(()=>state.me.week_layout),'seven');
  await page.locator('.bottom-nav [data-view="week"]').click();await wait();assert.equal(await page.locator('.timeline-day').count(),7);
  await page.selectOption('#demo-user','2');await wait();assert.equal(await page.evaluate(()=>state.me.week_layout),'agenda');
  assert.deepEqual(errors,[]);console.log('week timeline integration: ok');
 }finally{await browser?.close();server.kill();rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
