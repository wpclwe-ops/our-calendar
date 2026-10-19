const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),{readFileSync}=require('node:fs'),{join}=require('node:path');

function app(provider){
 const calls=[],accounts=[1,2].map(n=>({id:'account-'+n,sources:[{id:'source-'+n,name:'Calendar '+n,links:[]}]}));
 const items=[{id:'event',title:'Private event',start:'2026-10-24T12:00',end:'2026-10-24T13:00',supported:true}];
 const context=vm.createContext({words:{ru:{back:'Назад'},en:{back:'Back'}},actions:{back:()=>{throw Error('unexpected settings navigation')}},
  page:provider,tab:'settings',busy:false,URLSearchParams,smartSettingsPage:()=>'',
  isoDay:()=>'2026-10-19',addDays:day=>day,esc:value=>String(value),
  button:(action,label)=>`<button data-action="${action}">${label}</button>`,
  $:()=>({addEventListener(){}}),window:{addEventListener(){}},setInterval(){},render(){},
  api:async(path,method)=>{calls.push({path,method:method||'GET'});if(context.fail)throw Error('network');
   if(path.includes('/accounts/account-2/calendars'))return [{id:'source-2',name:'Calendar 2',selected:1}];
   if(path.includes('/sources/source-2/events'))return {items,next_page:null};
   throw Error('unexpected endpoint '+path);
  }});
 context.t=key=>context.words.ru[key]||key;
 for(const file of ['google-import.js','icloud-import.js','settings.js'])vm.runInContext(readFileSync(join(__dirname,'../web',file),'utf8'),context);
 vm.runInContext(`Object.assign(${provider}UI,{account:'account-1',status:${JSON.stringify({configured:true,accounts})}});settingsParent='connections'`,context);
 return {context,calls,run:code=>vm.runInContext(code,context),action:name=>context.actions[name]};
}

for(const provider of ['google','icloud']){
 for(const control of ['page','header'])test(`${provider} ${control} Back opens the source account's calendars`,async()=>{
  const a=app(provider);
  await a.action(provider+'-events')({dataset:{id:'source-2'}});
  assert.equal(a.run(`${provider}UI.account`),'account-2');
  const html=a.run(`${provider}ImportPage()`);
  assert.ok(html.includes(`data-action="${provider}-events-back"`));
  assert.ok(!html.includes('data-action="google-root"'));
  await a.action(control==='header'?'back':provider+'-events-back')();
  assert.equal(a.run(`${provider}UI.step`),'calendars');
  assert.equal(a.run(`${provider}UI.account`),'account-2');
  assert.ok(a.run(`${provider}ImportPage()`).includes('Calendar 2'));
  assert.equal(a.calls.at(-1).path,provider+'/accounts/account-2/calendars');
  assert.ok(a.calls.every(call=>call.method==='GET'));
 });
 test(`${provider} failed Back preserves the event picker for retry`,async()=>{
  const a=app(provider);
  await a.action(provider+'-events')({dataset:{id:'source-2'}});
  if(provider==='google')a.run("googleUI.selected.set('event',googleUI.items[0])");
  const before=a.run(`JSON.stringify(${provider}UI.items)`);
  a.context.fail=true;
  await assert.rejects(a.action(provider+'-events-back')(),/network/);
  assert.equal(a.run(`${provider}UI.step`),'events');
  assert.equal(a.run(`JSON.stringify(${provider}UI.items)`),before);
  if(provider==='google')assert.equal(a.run('googleUI.selected.size'),1);
  a.context.fail=false;
  await a.action(provider+'-events-back')();
  assert.equal(a.run(`${provider}UI.step`),'calendars');
  assert.ok(a.calls.every(call=>call.method==='GET'));
 });
}
