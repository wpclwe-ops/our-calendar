const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');

function setup(reduced=false){
 const make=()=>({style:{},dataset:{view:'day'},inert:false,connected:true,
  classList:{add(){},remove(){}},setAttribute(){},removeAttribute(){},
  querySelector(){return null},remove(){this.connected=false},
  get isConnected(){return this.connected&&viewport.connected},
  animate(){return {finished:Promise.resolve(),cancel(){}}}});
 const viewport={connected:true,clientWidth:390,classList:{add(){},remove(){}},
  setAttribute(){},removeAttribute(){},parentElement:{querySelector(){return null}},
  append(node){node.connected=true},get isConnected(){return this.connected},
  querySelector(){return current}};
 const current=make(),incoming=make(),commits=[];
 const context={module:{exports:{}},document:{querySelector(){return viewport}},
  matchMedia:()=>({matches:reduced}),cancelAnimationFrame(){},
  getComputedStyle:node=>({transform:node.style.transform||'none',opacity:'1'})};
 vm.runInNewContext(readFileSync(require.resolve('../web/calendar-navigation.js'),'utf8'),context);
 const motion=context.module.exports.motion({preview:()=>incoming});
 return {viewport,current,incoming,commits,motion};
}

for(const reduced of [false,true]){
 test(`a page replaced during a pending transition renders the target afresh (reduced=${reduced})`,async()=>{
  const s=setup(reduced);let release;
  const ready=new Promise(resolve=>release=resolve);
  const transition=s.motion.finish({type:'view',view:'month',direction:1},()=>s.incoming,
   page=>s.commits.push(page),ready,true);
  // A background refresh replaces the live viewport while the save is pending.
  s.viewport.connected=false;release();await transition;
  assert.equal(s.commits.length,1);
  assert.equal(s.commits[0],undefined,'detached incoming DOM must not become the live target');
  assert.equal(s.current.inert,false);
 });
}

test('an attached incoming page is adopted without rebuilding',async()=>{
 const s=setup();
 await s.motion.finish({type:'view',view:'month',direction:1},()=>s.incoming,
  page=>s.commits.push(page),Promise.resolve(),true);
 assert.equal(s.commits[0],s.incoming);
 assert.equal(s.incoming.inert,false);
});

test('a failed preference save retains the outgoing page and does not commit',async()=>{
 const s=setup();
 await assert.rejects(s.motion.finish({type:'view',view:'month',direction:1},()=>s.incoming,
  page=>s.commits.push(page),Promise.reject(new Error('save failed')),true),/save failed/);
 assert.equal(s.commits.length,0);
 assert.equal(s.current.inert,false);
 assert.equal(s.incoming.connected,false);
});
