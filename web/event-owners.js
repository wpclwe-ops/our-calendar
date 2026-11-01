/* Initial avatars carry ownership independently of category colours. */
(function(root){
 'use strict';
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function initial(name){
  const value=String(name||'').trim();
  if(!value)return '?';
  const first=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)][0].segment:Array.from(value)[0];
  return first.toLocaleUpperCase();
 }
 function render(owner,members,calendar,labels={},compact=false){
  const ids=owner==='both'?[calendar.first_id,calendar.second_id].filter(Boolean):[owner];
  const people=ids.map(id=>members.find(m=>m.id===id)||{name:labels.unknown||'?'});
  const names=people.map(p=>String(p.name||'').trim()||labels.unknown||'?');
  return `<span class="owner-avatars${compact?' owner-avatars-compact':''}" role="img" aria-label="${escape(names.join(', ')||labels.both||'?')}">${names.map(name=>`<span class="owner-avatar" aria-hidden="true">${escape(initial(name))}</span>`).join('')}</span>`;
 }
 const api={initial,render};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EventOwners=api;
})(globalThis);
