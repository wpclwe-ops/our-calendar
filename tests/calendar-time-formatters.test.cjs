const test=require('node:test'),assert=require('node:assert/strict');
const Real=Intl.DateTimeFormat;let built=0;
Intl.DateTimeFormat=new Proxy(Real,{construct(t,a,n){built++;return Reflect.construct(t,a,n)}});
const T=require('../web/calendar-time.js');
test('local() reuses one formatter per time zone',()=>{
 built=0;
 for(let i=0;i<500;i++){T.local(Date.UTC(2026,5,1,12,i%60),'Europe/Warsaw');T.local(Date.UTC(2026,5,1,12,i%60),'Australia/Melbourne')}
 assert.equal(built,2);
 T.local(Date.UTC(2026,5,1),'Europe/Warsaw');
 assert.equal(built,2);
});
test('local() output is unchanged around DST and across zones',()=>{
 assert.equal(T.local('2026-03-29T00:59:00Z','Europe/Warsaw'),'2026-03-29T01:59');
 assert.equal(T.local('2026-03-29T01:00:00Z','Europe/Warsaw'),'2026-03-29T03:00');
 assert.equal(T.local('2026-10-25T00:30:00Z','Europe/Warsaw'),'2026-10-25T02:30');
 assert.equal(T.local('2026-10-25T01:30:00Z','Europe/Warsaw'),'2026-10-25T02:30');
 assert.equal(T.local('2026-10-16T20:10:00Z','Australia/Melbourne'),'2026-10-17T07:10');
 assert.equal(T.local('2026-01-01T00:00:00Z','UTC'),'2026-01-01T00:00');
});
