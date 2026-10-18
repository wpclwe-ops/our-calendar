const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../web/calendar-week.js'),T=require('../web/calendar-time.js');
const event=(id,start,end)=>({id,start_utc:start,end_utc:end});
test('three-day windows include the selection and stay inside its Monday–Sunday week',()=>{
 assert.deepEqual(W.days('2026-10-18','three'),['2026-10-16','2026-10-17','2026-10-18']);
 assert.deepEqual(W.days('2026-10-12','three'),['2026-10-12','2026-10-13','2026-10-14']);
 assert.deepEqual(W.days('2027-01-01','seven'),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
 for(let i=12;i<=18;i++){const day='2026-10-'+i,days=W.days(day,'three');assert.equal(days.length,3);assert.ok(days.includes(day));assert.ok(days[0]>='2026-10-12'&&days[2]<='2026-10-18')}
});
test('time columns clip cross-midnight events and exclude exclusive midnight ends and all-day events',()=>{
 const items=[event('night','2026-10-16T21:30Z','2026-10-17T01:00Z'),event('midnight','2026-10-16T20:00Z','2026-10-16T22:00Z'),{id:'all',all_day:true}];
 const fri=W.groups(items,'2026-10-16','Europe/Warsaw',T.local).flatMap(g=>g.items);
 assert.equal(fri.find(x=>x.event.id==='night').start,1410);assert.equal(fri.find(x=>x.event.id==='night').end,1440);
 const sat=W.groups(items,'2026-10-17','Europe/Warsaw',T.local).flatMap(g=>g.items);
 assert.equal(sat.length,1);assert.equal(sat[0].start,0);assert.equal(sat[0].end,180);
});
test('overlapping events share lanes only within their connected overlap group',()=>{
 const groups=W.groups([event('a','2026-10-16T09:00Z','2026-10-16T10:00Z'),event('b','2026-10-16T09:30Z','2026-10-16T11:00Z'),event('c','2026-10-16T11:00Z','2026-10-16T12:00Z')],'2026-10-16','UTC',T.local);
 assert.equal(groups.length,2);assert.equal(groups[0].lanes.length,2);assert.equal(groups[1].lanes.length,1);
});
test('viewer timezone places events in the correct date, including repeated DST hours',()=>{
 const e=event('dst','2026-10-25T00:45Z','2026-10-25T01:15Z');
 const [group]=W.groups([e],'2026-10-25','Europe/Warsaw',T.local);assert.ok(group.items[0].end>group.items[0].start);
 assert.equal(W.groups([event('east','2026-10-16T23:00Z','2026-10-17T00:00Z')],'2026-10-17','Asia/Tokyo',T.local)[0].items[0].start,480);
});
