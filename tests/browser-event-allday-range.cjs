// Inclusive dates in UI, exclusive end in real local API/DB/ICS. Chromium emulation, not Telegram iOS.
const assert=require('node:assert/strict');
const {withDemo,openPage}=require('./helpers/browser-fixture.cjs');
const next=day=>{const date=new Date(day+'T12:00Z');date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10)};

(async()=>{
 for(const timezone of ['Europe/Warsaw','Australia/Melbourne'])for(const language of ['ru','en'])await withDemo(async({browser,url})=>{
  const {page,context,errors}=await openPage(browser,url,{timezoneId:timezone});
  const change=async(name,value)=>{await page.locator(`[name="${name}"]`).fill(value);await page.locator(`[name="${name}"]`).dispatchEvent('change');};
  const save=async()=>{
   assert.equal(await page.locator('#event-form').evaluate(form=>form.checkValidity()),true,'form is valid');
   await page.locator('#event-form').evaluate(form=>form.requestSubmit());
   await page.waitForFunction(()=>page==='detail'||!!document.querySelector('#form-error')?.textContent);
   assert.equal(await page.evaluate(()=>document.querySelector('#form-error')?.textContent||''),'','save error');
   await page.waitForFunction(()=>!busy);await page.waitForSelector('.event-detail');
  };
  const edit=async()=>{await page.locator('[data-action=edit-event]').click();await page.waitForSelector('#event-form');};
  const cases=[['2026-11-03','2026-11-05'],['2026-11-07','2026-11-07'],['2026-11-30','2026-12-02'],['2026-12-31','2027-01-02'],['2028-02-28','2028-03-01']];
   await page.evaluate(async({language,timezone})=>{state=await api('settings','PATCH',{language,timezone});render()},{language,timezone});
   for(const [start,last] of cases){
    await page.evaluate(day=>newEvent(day),start);
    await page.locator('[name=title]').fill('All-day regression');await page.locator('[name=all_day]').check();
    assert.equal(await page.inputValue('[name=end]'),start,'new all-day defaults to one inclusive day');
    await change('end',last);await save();
    const id=await page.evaluate(()=>currentEvent.id);
    const stored=()=>page.evaluate(id=>api('events/'+id),id);
    assert.equal((await stored()).end,next(last),'API end remains exclusive');
    const label=await page.locator('.detail-block strong').first().textContent();
    const expected=await page.evaluate(({start,last})=>{
     const options={weekday:'short',day:'numeric',month:'long',year:'numeric'};
     return {start:dateLabel(start,{...options,year:start.slice(0,4)===last.slice(0,4)?undefined:'numeric'}),last:dateLabel(last,options)};
    },{start,last});
    assert.ok(label.includes(expected.last),'detail includes the final date');
    assert.ok(label.startsWith(start===last?expected.last:expected.start),'detail includes the first date');
    assert.equal(label.includes(' – '),start!==last,'one day has no redundant range');
    if(start.slice(0,4)!==last.slice(0,4))assert.ok(label.includes(start.slice(0,4)),'cross-year detail includes both years');
    for(let round=0;round<2;round++){
     await edit();assert.equal(await page.inputValue('[name=start]'),start);assert.equal(await page.inputValue('[name=end]'),last);
     // Recurrence/reminder rerenders capture the form too; conversion must never accumulate.
     await page.selectOption('[name=repeat]','DAILY');await page.selectOption('[name=repeat]','');
     await save();assert.equal((await stored()).end,next(last),'repeated capture/save is stable');
    }
    // Real loaded calendar data, shared day-membership used by all calendar views.
    const membership=await page.evaluate(async({id,start,last})=>{
     const rows=await api('events?'+new URLSearchParams({start:addDays(start,-1),end:addDays(last,2)})),event=rows.find(e=>e.id===id);
     const days=[];for(let day=addDays(start,-1);day<=addDays(last,1);day=addDays(day,1))days.push([day,onDay(event,day)]);
     const ics=await (await api('calendar.ics','GET',null,true)).text();
     selected=start;view='week';state.me.week_layout='seven';events=rows;page='main';tab='calendar';render();
     return {days,ics};
    },{id,start,last});
    assert.deepEqual(membership.days.map(([day,shown])=>[day,Boolean(shown)]),membership.days.map(([day])=>[day,day>=start&&day<=last]));
    assert.ok(membership.ics.includes('DTEND;VALUE=DATE:'+next(last).replaceAll('-','')),'ICS retains exclusive end');
    const week=await page.evaluate(()=>weekDays());
    for(const [index,day] of week.entries())assert.equal(await page.locator('.week-all-day .week-columns > div').nth(index).locator(`[data-id="${id}"]`).count(),day>=start&&day<=last?1:0,'week renders exactly the included days');
    await page.evaluate(async id=>openEvent(id),id);
    // Editing the inclusive end updates it once.
    await edit();await change('end',next(last));await save();assert.equal((await stored()).end,next(next(last)));
    // A start moved past the old end clamps the visible last day to the new start.
    await edit();const moved=next(next(last));await change('start',moved);assert.equal(await page.inputValue('[name=end]'),moved);
    await save();assert.equal((await stored()).end,next(moved));
   }
  // A pre-existing exclusive-end event (same contract as provider imports) is stable on first edit.
  await page.evaluate(async()=>{const e=await api('events','POST',{title:'Imported contract',start:'2026-11-03',end:'2026-11-06',all_day:true});await openEvent(e.id)});
  await edit();assert.equal(await page.inputValue('[name=end]'),'2026-11-05');await save();
  assert.equal(await page.evaluate(()=>currentEvent.end),'2026-11-06');
  for(const width of [320,390,402,430])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:874});await page.evaluate(theme=>{state.me.theme=theme;render()},theme);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'date detail fits '+width+'/'+language+'/'+theme);
   await edit();assert.equal(await page.inputValue('[name=end]'),'2026-11-05');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'date form fits '+width+'/'+language+'/'+theme);
   await page.locator('[data-action=back]').click();await page.waitForFunction(()=>!busy);
  }
  // Timed behavior and transitions keep the existing defaults/move-start policy.
  await page.evaluate(()=>newEvent('2026-11-03',600));await page.locator('[name=title]').fill('Timed regression');
  await change('end','2026-11-03T12:15');await save();
  assert.equal(await page.evaluate(()=>currentEvent.end.slice(0,16)),'2026-11-03T12:15');
  await edit();await page.locator('[name=all_day]').check();assert.equal(await page.inputValue('[name=end]'),'2026-11-03');
  await page.locator('[name=all_day]').uncheck();assert.equal(await page.getAttribute('[name=end]','type'),'datetime-local');
  await page.locator('[name=all_day]').check();await save();assert.equal(await page.evaluate(()=>currentEvent.end),'2026-11-04');
  assert.deepEqual(errors,[]);await context.close();
  console.log('PASS: all-day '+language+' / '+timezone);
 });
 console.log('PASS: all-day create/edit/reopen/rerender, single/multiple days, month/year/leap boundaries, both years in detail, exclusive API/ICS, calendar membership, start clamp, timed/toggle behavior; RU/EN, Warsaw/Melbourne.');
})().catch(error=>{console.error(error);process.exitCode=1});
