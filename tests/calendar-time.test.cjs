const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../web/calendar-time.js');
test('new events use current time in the profile timezone and selected date',()=>{
 const now=new Date('2026-10-16T20:10:00Z');
 assert.deepEqual(T.defaults('2026-10-17','Europe/Warsaw',30,now),{start:'2026-10-17T22:10',end:'2026-10-17T22:40'});
 assert.deepEqual(T.defaults('2026-10-17','Australia/Melbourne',120,now),{start:'2026-10-17T07:10',end:'2026-10-17T09:10'});
 assert.deepEqual(T.defaults('2026-10-16','Europe/Warsaw',60,now,1410),{start:'2026-10-16T23:30',end:'2026-10-17T00:30'});
});
test('changing start preserves duration and explicit end until it becomes invalid',()=>{
 const previous={start:'2026-10-16T22:10',end:'2026-10-16T23:10'};
 assert.deepEqual(T.moveStart(previous,'2026-10-16T22:30'),{start:'2026-10-16T22:30',end:'2026-10-16T23:30'});
 assert.equal(T.moveStart(previous,'2026-10-16T22:30',true).end,'2026-10-16T23:10');
 assert.equal(T.moveStart(previous,'2026-10-16T23:30',true).end,'2026-10-17T00:30');
});
test('drag in viewer timezone preserves event timezone and elapsed duration across midnight',()=>{
 const e={start_utc:'2026-10-16T10:00:00Z',end_utc:'2026-10-16T11:30:00Z',timezone:'Australia/Melbourne'};
 assert.deepEqual(T.moveEvent(e,'2026-10-16',23*60+30,'Europe/Warsaw'),{start:'2026-10-17T08:30',end:'2026-10-17T10:00',fold:0,end_fold:0});
});
test('DST gaps are rejected and repeated hours retain an explicit fold',()=>{
 assert.throws(()=>T.resolve('2026-03-29T02:30','Europe/Warsaw'),/nonexistent_local_time/);
 assert.equal(new Date(T.resolve('2026-10-25T02:30','Europe/Warsaw',0)).toISOString(),'2026-10-25T00:30:00.000Z');
 assert.equal(new Date(T.resolve('2026-10-25T02:30','Europe/Warsaw',1)).toISOString(),'2026-10-25T01:30:00.000Z');
 const e={start_utc:'2026-10-25T01:30:00Z',end_utc:'2026-10-25T02:30:00Z',timezone:'Europe/Warsaw',fold:1};
 assert.deepEqual(T.moveEvent(e,'2026-10-25',150,'Europe/Warsaw'),{start:'2026-10-25T02:30',end:'2026-10-25T03:30',fold:1,end_fold:0});
});
