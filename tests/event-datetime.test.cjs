const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../web/event-datetime.js');
const base={start:'2026-10-30T19:30',end:'2026-10-30T20:30',timezone:'Europe/Warsaw'};
test('date and wheel edits preserve duration across midnight, month and year boundaries',()=>{
 const m=D.model({...base,start:'2026-12-31T23:30',end:'2027-01-01T00:30'});
 m.setClock('start','minute',45);assert.equal(m.value().end,'2027-01-01T00:45');
 m.setDate('start','2028-02-29');assert.equal(m.value().end,'2028-03-01T00:45');assert.equal(m.status().minutes,60);
});
test('independent wheels wrap and can select every single minute without rounding',()=>{
 const m=D.model(base);m.setClock('start','minute',7);assert.equal(m.value().start,'2026-10-30T19:07');
 m.setClock('start','hour',24);assert.equal(m.value().start,'2026-10-30T00:07');
 m.setClock('start','minute',-1);assert.equal(m.value().start,'2026-10-30T00:59');
});
test('explicit valid end is retained when start moves, and follows duration when it becomes invalid',()=>{
 const m=D.model(base);m.setClock('end','hour',22);assert.equal(m.value().manualEnd,true);
 m.setClock('start','hour',20);assert.equal(m.value().end,'2026-10-30T22:30');
 const reopened=D.model(m.value());reopened.setClock('start','hour',23);assert.equal(reopened.value().end,'2026-10-31T01:30');
});
test('end time crossing midnight advances a date; an explicitly earlier end date fails validation',()=>{
 const m=D.model({...base,start:'2026-10-30T23:00',end:'2026-10-30T23:30'});
 m.setClock('end','hour',0);assert.equal(m.value().end,'2026-10-31T00:30');assert.equal(m.status().minutes,90);
 m.setDate('end','2026-10-29');assert.equal(m.status().valid,false);assert.equal(m.status().errors[0].code,'end_must_follow_start');
});
test('separate date and time changes do not lose a manual end while passing an invalid intermediate start',()=>{
 const m=D.model({...base,start:'2026-10-16T23:30',end:'2026-10-17T02:00',manualEnd:true});
 m.setDate('start','2026-10-17');assert.equal(m.value().end,'2026-10-18T02:00');
 m.setClock('start','hour',0);m.setClock('start','minute',0);assert.equal(m.value().end,'2026-10-17T02:00');
 const n=D.model({...base,start:'2026-10-24T23:30',end:'2026-10-25T03:30',fold:0,end_fold:0});
 n.setClock('start','hour',0);n.setClock('start','hour',23);assert.equal(n.status().minutes,300);
});
test('duration presets mean elapsed minutes across spring and autumn DST transitions',()=>{
 for(const [start,end] of [['2026-03-29T01:30','2026-03-29T03:30'],['2026-10-25T02:30','2026-10-25T02:30']]){
  const m=D.model({...base,start,end,fold:0,end_fold:1});m.setDuration(60);
  assert.equal(m.value().end,end);assert.equal(m.status().minutes,60);assert.equal(m.status().valid,true);
 }
});
test('DST gap is blocked and a repeated hour requires an explicit occurrence',()=>{
 const gap=D.model({...base,start:'2026-03-29T02:30',end:'2026-03-29T04:30'});assert.equal(gap.status().errors[0].code,'nonexistent_local_time');
 const repeated=D.model({...base,start:'2026-10-25T02:30',end:'2026-10-25T03:30'});
 assert.equal(repeated.status().errors[0].code,'ambiguous_local_time_choose_fold');
 repeated.setFold('start',1);assert.equal(repeated.status().minutes,60);assert.equal(repeated.status().valid,true);
});
test('event zone wins over device timezone and existing fold survives an unchanged selection',()=>{
 const m=D.model({...base,start:'2026-10-25T02:30',end:'2026-10-25T03:30',fold:1,end_fold:0});
 m.setClock('start','hour',2);assert.equal(m.value().fold,1);assert.equal(m.status().minutes,60);
 const australia=D.model({...base,timezone:'Australia/Melbourne',start:'2026-10-04T01:30',end:'2026-10-04T04:30'});
 australia.setDuration(60);assert.equal(australia.value().end,'2026-10-04T03:30');assert.equal(australia.status().valid,true);
});
test('clarifying a repeated start hour keeps an automatically generated or preset duration',()=>{
 const m=D.model({...base,start:'2026-10-25T01:30',end:'2026-10-25T02:30',fold:0,end_fold:0});
 m.setClock('start','hour',2);assert.equal(m.status().valid,false);m.setFold('start',1);
 assert.equal(m.value().end,'2026-10-25T03:30');assert.equal(m.status().minutes,60);assert.equal(m.status().valid,true);
 const n=D.model({...base,start:'2026-10-25T02:30',end:'2026-10-25T03:30'});n.setDuration(60);n.setFold('start',1);
 assert.equal(n.status().minutes,60);assert.equal(n.status().valid,true);
});
test('cancel checkpoints restore the whole draft and untouched non-grid seconds are retained',()=>{
 const m=D.model({...base,start:'2026-10-30T19:30:15',end:'2026-10-30T20:30:15'}),checkpoint=m.value();
 m.setClock('start','minute',30);assert.deepEqual(m.value(),checkpoint);
 m.setDuration(90);m.restore(checkpoint);assert.deepEqual(m.value(),checkpoint);
 assert.throws(()=>m.setDate('start','2026-02-30'),/invalid_datetime/);
 assert.throws(()=>m.setDuration(0),/invalid_duration/);
});
test('all-day picker uses an inclusive final date and exclusive storage across months and leap days',()=>{
 const m=D.model({...base,start:'2028-02-28',end:'2028-03-01',all_day:true});
 assert.equal(m.status().minutes,2*1440);m.setDate('end','2028-03-02');assert.equal(m.value().end,'2028-03-03');
 m.setDate('start','2028-02-29');assert.equal(m.value().end,'2028-03-04');
 m.setDate('end','2028-02-28');assert.equal(m.status().valid,false);
 assert.throws(()=>m.setDate('start','2028-02-30'),/invalid_datetime/);
});
test('timed/all-day toggles preserve the original clocks and do not include a midnight boundary',()=>{
 const m=D.model({...base,start:'2026-10-31T23:00',end:'2026-11-01T00:00'});
 m.setAllDay(true);assert.equal(m.value().start,'2026-10-31');assert.equal(m.value().end,'2026-11-01');
 m.setAllDay(false);assert.equal(m.value().start,'2026-10-31T23:00');assert.equal(m.value().end,'2026-11-01T00:00');
 const n=D.model(base);n.setAllDay(true);n.setDate('end','2026-11-02');n.setAllDay(false);
 assert.equal(n.value().start,'2026-10-30T19:30');assert.equal(n.value().end,'2026-11-02T20:30');
});
test('all-day dates are independent of time zones and DST gaps',()=>{
 for(const zone of ['Europe/Warsaw','Australia/Melbourne','Pacific/Apia']){
  const m=D.model({start:'2026-03-29',end:'2026-03-30',all_day:true,timezone:zone});
  assert.equal(m.status().valid,true);assert.equal(m.status().minutes,1440);
  m.setDate('end','2026-03-29');assert.equal(m.value().end,'2026-03-30');
 }
});
