const {test}=require('node:test'),assert=require('node:assert/strict');
const {initial,render}=require('../web/event-owners.js');
const members=[{id:'1',name:'Alice'},{id:'2',name:'Борис'}],calendar={first_id:'1',second_id:'2'};
test('owners use actual profile initials and stable pair order, independently of viewer',()=>{
 assert.match(render('1',members,calendar),/>A<\/span>/);
 assert.match(render('2',members,calendar),/>Б<\/span>/);
 const both=render('both',[...members].reverse(),calendar);
 assert.equal((both.match(/class="owner-avatar"/g)||[]).length,2);
 assert.match(both,/aria-label="Alice, Борис"/);
 assert.ok(both.indexOf('>A<')<both.indexOf('>Б<'));
 assert.doesNotMatch(both,/data-bg|data-fg|style=/);
});
test('initials support graphemes, blank names and profile changes',()=>{
 assert.equal(initial('  alice  '),'A');assert.equal(initial('ёлена'),'Ё');
 assert.equal(initial('e\u0301milie'),'E\u0301');assert.equal(initial('👩‍🔬 Test'),'👩‍🔬');
 assert.equal(initial('  '),'?');
 assert.match(render('1',[{id:'1',name:'Changed'}],calendar),/>C<\/span>/);
 assert.equal((render('both',members,{first_id:'1',second_id:null}).match(/class="owner-avatar"/g)||[]).length,1);
});
test('untrusted names are escaped in labels and initials',()=>{
 const html=render('1',[{id:'1',name:'<img src=x onerror="bad()"> & hi'}],calendar,{},true);
 assert.match(html,/owner-avatars-compact/);assert.doesNotMatch(html,/<img/);
 assert.match(html,/&lt;img/);assert.match(html,/&quot;bad/);assert.match(html,/>\&lt;<\/span>/);
});
