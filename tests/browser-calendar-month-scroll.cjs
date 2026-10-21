// Synthetic API data only. Chromium emulation (and optional Linux WebKit) is not iOS device QA.
const {chromium,webkit}=require('playwright');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync,mkdirSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-month-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'8017'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
  const engine=process.env.CALENDAR_BROWSER==='webkit'?'webkit':'chromium';
  browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'&&process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const context=await browser.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Hide the fallback header as in a signed-in Telegram WebView, without a live Telegram account.
  await page.route('https://telegram.org/**',r=>r.fulfill({contentType:'application/javascript',body:'window.Telegram={WebApp:{initData:"synthetic",ready(){},expand(){},onEvent(){},disableVerticalSwipes(){}}}'}));
  await page.clock.install({time:new Date('2026-10-22T10:00:00Z')});
  await page.goto('http://127.0.0.1:8017');await page.waitForSelector('.timeline');
  const wait=async()=>{await page.waitForFunction(()=>!busy&&!calendarSwipe.active()&&!calendarTouch.active()&&!monthLoading);await page.waitForTimeout(120)};
  const fixtures=await page.evaluate(async()=>{
   state=await api('settings','PATCH',{month_layout:'scroll',theme:'dark',timezone:'Europe/Warsaw'});
   for(const e of new Map((await api('events?start=2026-09-01&end=2026-12-01')).map(e=>[e.id,e])).values())await api('events/'+e.id,'DELETE',{revision:e.revision,confirmed:true});
   const categories=await Promise.all(['#9B77D1','#6EAE92','#C77AA5','#BE985E'].map((color,i)=>api('categories','POST',{name:'Specimen '+i,color})));
   const make=(title,start,end,extra={})=>api('events','POST',{title,start,end,timezone:'Europe/Warsaw',category_id:categories[0].id,...extra});
   const series=await make('Терапия','2026-10-20T13:00','2026-10-20T14:00',{rrule:'FREQ=DAILY;COUNT=3',category_id:categories[1].id});
   await make('Verity: Coraz więcej pytań','2026-10-20T18:10','2026-10-20T20:00');
   const done=await make('Manicure — Studio SIA','2026-10-21T11:00','2026-10-21T12:00');await api('events/'+done.id,'PATCH',{revision:done.revision,status:'done'});
   await make('Pełny pedicure w salonie','2026-10-23T12:55','2026-10-23T14:00',{category_id:categories[2].id});
   const cancelled=await make('Warsztaty kolażu we Wrocławiu','2026-10-21T18:00','2026-10-21T20:00',{category_id:categories[1].id});await api('events/'+cancelled.id,'PATCH',{revision:cancelled.revision,status:'cancelled'});
   await make('Birthday','2026-10-23','2026-10-24',{all_day:true});
   await make('Dance event Amsterdam','2026-10-23T17:00','2026-10-23T19:00',{category_id:categories[1].id});
   await make('Hair, lashes and brows','2026-10-24T15:30','2026-10-24T17:00',{category_id:categories[2].id});
   // 0 / 1 / 3 / 5 / 7 events, long unbroken and multilingual text.
   for(let i=0;i<7;i++)await make(['Длинное название события на русском языке','Appointment with a very long English name','Warsztaty rękodzieła we Wrocławiu','Сверхдлинноесловобезпробелов','Кино','Hair','Coffee'][i],`2026-10-25T${String(9+i).padStart(2,'0')}:00`,`2026-10-25T${String(10+i).padStart(2,'0')}:00`);
   for(let i=0;i<5;i++)await make('Appointment '+i,'2026-10-27T12:00','2026-10-27T13:00');
   const span=await make('✈ Rotterdam','2026-10-26','2026-11-03',{all_day:true,category_id:categories[2].id});
   const night=await make('Flight Wrocław → Amsterdam','2026-10-31T23:30','2026-11-02T00:00',{category_id:categories[3].id});
   await make('Return at midnight','2026-10-29T22:00','2026-10-30T00:00');
   selected='2026-10-20';await changeView('month');await loadData();render();return {series,span,night,done,cancelled,category:categories[0]};
  });await wait();
  const cell=d=>page.locator(`.month-scroll .day[data-date="${d}"]`);
  assert.equal(await cell('2026-10-19').locator('.event-bar').count(),0);
  assert.equal(await cell('2026-10-24').locator('.event-bar').count(),1);
  assert.equal(await cell('2026-10-22').locator('.event-bar').count(),1);
  assert.equal(await cell('2026-10-21').locator('.event-bar').count(),3);
  assert.equal(await cell('2026-10-25').locator('.event-bar').count(),5);
  assert.equal(await cell('2026-10-25').locator('.more').textContent(),'+2');
  assert.equal(await cell('2026-10-27').locator('.more').textContent(),'+1','ribbon consumes one of the five slots');
  assert.ok(await cell('2026-10-22').locator('.day-number').evaluate(el=>getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)'));
  assert.ok(await cell('2026-10-20').locator('.day-number').evaluate(el=>getComputedStyle(el).boxShadow!=='none'));
  assert.equal(await page.locator(`.event-bar[data-id="${fixtures.done.id}"]`).evaluate(el=>getComputedStyle(el).opacity),'0.8');
  assert.match(await page.locator(`.event-bar[data-id="${fixtures.cancelled.id}"]`).evaluate(el=>getComputedStyle(el).textDecorationLine),/line-through/);
  assert.equal(await page.locator(`.month-span[data-id="${fixtures.span.id}"]`).count(),2,'one ribbon per intersecting week, including month boundary');
  assert.equal(await page.locator(`.scroll-week[data-week="2026-10-26"] .month-span[data-id="${fixtures.span.id}"]`).getAttribute('data-columns'),'7');
  assert.equal(await page.locator(`.scroll-week[data-week="2026-11-02"] .month-span[data-id="${fixtures.span.id}"]`).getAttribute('data-columns'),'1');
  assert.equal(await page.locator(`.scroll-week[data-week="2026-11-02"] .month-span[data-id="${fixtures.night.id}"]`).count(),0,'exclusive midnight end does not occupy Monday');
  const nav=await page.locator('.bottom-nav').innerHTML(),toolbar=await page.locator('.calendar-controls').innerHTML();
  const anchor=()=>page.locator('.month-scroll').evaluate(el=>monthAnchor(el));
  const typography=()=>cell('2026-10-25').locator('.event-bar').first().evaluate(el=>{const title=getComputedStyle(el.querySelector('.month-event-title')),time=getComputedStyle(el.querySelector('.month-event-time'));return [title.fontSize,title.lineHeight,title.webkitLineClamp,time.fontSize,time.display,el.getBoundingClientRect().height]});
  const baseline=await typography();assert.equal(baseline[0],'12px');assert.equal(baseline[4],'block');
  for(const theme of ['dark','light'])for(const width of [393,402]){
   await page.setViewportSize({width,height:874});await page.evaluate(theme=>{state.me.theme=theme;render()},theme);await wait();
   const stableHeight=(await typography())[5];
   for(const height of [500,620,760,874]){
    const before=await anchor();await page.setViewportSize({width,height});await wait();const after=await anchor();
    assert.equal(after.week,before.week);assert.ok(Math.abs(after.offset-before.offset)<2,'resize keeps the visible week and offset');
    // Width can affect wrapping, height never changes typography or card height.
    const atHeight=await typography();assert.deepEqual(atHeight.slice(0,5),baseline.slice(0,5));assert.equal(atHeight[5],stableHeight,'height changes never reflow the card');
    const geometry=await page.evaluate(()=>{
     const el=document.querySelector('.month-scroll'),r=el.getBoundingClientRect(),rows=[...el.querySelectorAll('.scroll-week')];
     return {left:r.left,right:innerWidth-r.right,overflow:document.documentElement.scrollWidth>innerWidth,fit:rows.every(row=>[...row.querySelectorAll('.month-day-events')].every(day=>day.getBoundingClientRect().bottom<=row.getBoundingClientRect().bottom)),columns:[...rows[0].querySelectorAll('.day')].map(d=>d.getBoundingClientRect().width)};
    });
    assert.ok(geometry.left<=5&&geometry.right<=5,'calendar uses the available width');assert.equal(geometry.overflow,false);assert.equal(geometry.fit,true,'five cards and +N never overlap the next week');
    assert.ok(Math.max(...geometry.columns)-Math.min(...geometry.columns)<1);
    const beforeRepaint=await anchor();await page.evaluate(()=>render());await wait();const afterRepaint=await anchor();assert.equal(afterRepaint.week,beforeRepaint.week);assert.ok(Math.abs(afterRepaint.offset-beforeRepaint.offset)<2);
   }
   if(process.env.CALENDAR_SCREENSHOT_DIR){mkdirSync(process.env.CALENDAR_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.CALENDAR_SCREENSHOT_DIR,`month-${engine}-${theme}-${width}.png`)});}
  }
  assert.equal(await page.locator('.bottom-nav').innerHTML(),nav);assert.equal(await page.locator('.calendar-controls').innerHTML(),toolbar);
  // Refresh data while scrolled, including a visible event changing its height.
  await page.locator('.month-scroll').evaluate(el=>el.scrollTop+=95);await wait();const beforeRefresh=await anchor();
  await page.evaluate(async()=>{await loadData();render()});await wait();const afterRefresh=await anchor();assert.equal(afterRefresh.week,beforeRefresh.week);assert.ok(Math.abs(afterRefresh.offset-beforeRefresh.offset)<2);
  // Shrinking a dense visible week keeps that week as the anchor, even when
  // its previous pixel offset no longer fits within the new content height.
  await page.locator('.month-scroll').evaluate(el=>{const row=el.querySelector('[data-week="2026-10-19"]');el.scrollTop=row.offsetTop+row.offsetHeight-20});await wait();
  const beforeShrink=await anchor();
  await page.evaluate(async()=>{for(const e of events.filter(e=>eventDay(e)==='2026-10-25').slice(0,5))await api('events/'+e.id,'PATCH',{revision:e.revision,title:'Updated'});await loadData();render()});await wait();
  const afterShrink=await anchor();assert.equal(afterShrink.week,beforeShrink.week,'data refresh keeps the visible week when its height shrinks');
  // Weekly append and prepend preserve position and never duplicate dates.
  await page.locator('.month-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(500);await wait();
  await page.locator('.month-scroll').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(500);await wait();
  const dates=await page.locator('.month-scroll .day').evaluateAll(es=>es.map(e=>e.dataset.date));assert.equal(new Set(dates).size,dates.length);
  // Filters still use the API, and reset restores the same recurring instances.
  await page.evaluate(async id=>{filter.category=id;await loadData();render()},fixtures.category.id);await wait();assert.equal(await page.locator(`.month-scroll [data-id="${fixtures.series.id}"]`).count(),0);
  await page.evaluate(async()=>{filter.category='';selected='2026-10-20';monthWindow=[];await loadData();render()});await wait();
  await cell('2026-10-21').locator(`[data-id="${fixtures.series.id}"]`).click();await page.waitForSelector('.detail-title');assert.equal(await page.evaluate(()=>currentEvent.selected_instance.occurrence),'2026-10-21T13:00');
  await page.locator('[data-action=back]').first().click();await wait();
  await page.locator(`.month-span[data-id="${fixtures.span.id}"]`).first().click();await page.waitForSelector('.detail-title');assert.equal(await page.locator('.detail-title').textContent(),'✈ Rotterdam');
  await page.locator('[data-action=back]').first().click();await wait();
  await cell('2026-10-25').locator('.more').click();await wait();assert.equal(await page.locator('.month-agenda .day-task').count(),7);
  await page.locator('.month-agenda [data-action=event]').last().click();await page.waitForSelector('.detail-title');assert.equal(await page.locator('.detail-title').textContent(),'Coffee');
  assert.deepEqual(errors,[]);console.log(`PASS (${engine}): stable scroll-month geometry, five-event budget, ribbons, recurrence, themes, resize anchors, refresh, filtering and detail/+N actions`);
 }finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
