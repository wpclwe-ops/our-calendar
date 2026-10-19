const test=require('node:test');
const assert=require('node:assert/strict');
const N=require('../web/calendar-navigation.js');

test('week numbers include the partial Monday-to-Sunday week at month start',()=>{
 assert.equal(N.weekHeading('2026-10-01').title,'1-я неделя октября');
 assert.equal(N.weekHeading('2026-10-04').title,'1-я неделя октября');
 assert.equal(N.weekHeading('2026-10-05').title,'2-я неделя октября');
 assert.equal(N.weekHeading('2026-10-16').title,'3-я неделя октября');
 assert.match(N.weekHeading('2026-10-16').range,/12–18 октября 2026/);
 assert.equal(N.weekHeading('2026-10-16','en').title,'Week 3 of October');
});
test('full week range names both months and both years when needed',()=>{
 assert.match(N.weekHeading('2026-10-01').range,/28 сентября – 4 октября 2026/);
 assert.match(N.weekHeading('2027-01-01').range,/28 декабря 2026.*3 января 2027/);
 assert.equal(N.weekHeading('2026-11-01').title,'1-я неделя ноября');
 assert.match(N.weekHeading('2026-11-01').range,/26 октября – 1 ноября 2026/);
});
test('month movement retains the selected day and clamps at month end',()=>{
 assert.equal(N.shift('2026-10-16','month',1),'2026-11-16');
 assert.equal(N.shift('2026-01-31','month',1),'2026-02-28');
 assert.equal(N.shift('2028-01-31','month',1),'2028-02-29');
 assert.equal(N.shift('2026-12-16','month',1),'2027-01-16');
 assert.equal(N.shift('2026-01-16','month',-1),'2025-12-16');
});
test('week/day movement crosses DST and year boundaries without changing weekday',()=>{
 assert.equal(N.shift('2026-10-23','week',1),'2026-10-30');
 assert.equal(N.shift('2026-12-31','day',1),'2027-01-01');
 assert.equal(N.shift('2026-10-25','day',-1),'2026-10-24');
});
test('short swipes move a period in either direction in every view',()=>{
 for(const view of ['month','week','day']){
  assert.deepEqual(N.gesture(-70,4,375,view),{type:'move',direction:1});
  assert.deepEqual(N.gesture(70,-4,375,view),{type:'move',direction:-1});
 }
});
test('long swipes change only one view, and stop at month/day',()=>{
 assert.deepEqual(N.gesture(-300,0,375,'month'),{type:'view',view:'week'});
 assert.deepEqual(N.gesture(-300,0,375,'week'),{type:'view',view:'day'});
 assert.deepEqual(N.gesture(300,0,375,'day'),{type:'view',view:'week'});
 assert.deepEqual(N.gesture(300,0,375,'week'),{type:'view',view:'month'});
 assert.deepEqual(N.gesture(-300,0,375,'day'),{type:'limit'});
 assert.deepEqual(N.gesture(300,0,375,'month'),{type:'limit'});
});
test('taps, vertical scroll and ambiguous diagonal movements do not navigate',()=>{
 for(const [dx,dy] of [[5,0],[43,0],[30,200],[100,90],[-100,-90]])assert.equal(N.gesture(dx,dy,375,'month'),null);
});
test('long swipe remains reachable on small phones and large screens',()=>{
 assert.deepEqual(N.gesture(-250,0,320,'month'),{type:'view',view:'week'});
 assert.deepEqual(N.gesture(-350,0,1200,'month'),{type:'view',view:'week'});
});

test('an ordinary thumb swipe on an iPhone 17 moves the week instead of changing view',()=>{
 for(const dx of [-221,-260,-290])assert.deepEqual(N.gesture(dx,0,402,'week'),{type:'move',direction:1});
 for(const dx of [221,260,290])assert.deepEqual(N.gesture(dx,0,402,'week'),{type:'move',direction:-1});
 assert.deepEqual(N.gesture(-305,0,402,'week'),{type:'view',view:'day'});
});

test('long swipes follow personal Touch Bar order and skip hidden views',()=>{
 const items=['month','day','settings'];
 assert.deepEqual(N.gesture(-300,0,375,'month',items),{type:'view',view:'day'});
 assert.deepEqual(N.gesture(300,0,375,'day',items),{type:'view',view:'month'});
 assert.deepEqual(N.gesture(-300,0,375,'day',items),{type:'tab',tab:'settings'});
 assert.deepEqual(N.gesture(300,0,375,'settings',items),{type:'view',view:'day'});
 assert.deepEqual(N.gesture(-300,0,375,'settings',items),{type:'limit'});
 assert.deepEqual(N.gesture(300,0,375,'month',items),{type:'limit'});
 assert.deepEqual(N.gesture(-300,0,375,'week',items),{type:'limit'});
});
test('reordered categories and calendar tabs work in both directions',()=>{
 const items=['categories','week','month','day','settings'];
 assert.deepEqual(N.gesture(-300,0,375,'categories',items),{type:'view',view:'week'});
 assert.deepEqual(N.gesture(300,0,375,'week',items),{type:'tab',tab:'categories'});
 assert.deepEqual(N.gesture(-300,0,375,'week',items),{type:'view',view:'month'});
 assert.deepEqual(N.gesture(70,0,375,'settings',items),null);
 assert.deepEqual(N.gesture(-70,0,375,'categories',items),null);
 assert.deepEqual(N.gesture(-70,0,375,'day',items),{type:'move',direction:1});
});
