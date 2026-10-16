/* Calendar recurrence controls. Keeps unsupported imported rules unchanged. */
(function(root){
 'use strict';
 const DAYS=['MO','TU','WE','TH','FR','SA','SU'];
 function defaults(start){const date=(start||'2026-01-01').slice(0,10);const d=new Date(date+'T12:00:00Z');return {freq:'',interval:1,days:[DAYS[(d.getUTCDay()+6)%7]],monthMode:'date',monthDay:d.getUTCDate(),ordinal:Math.ceil(d.getUTCDate()/7),weekday:DAYS[(d.getUTCDay()+6)%7],endMode:'never',count:10,until:date,preserve:''}}
 function parse(rule,start,timezone='UTC'){
  const c=defaults(start);if(!rule)return c;
  const p=Object.fromEntries(rule.replace(/^RRULE:/,'').split(';').map(x=>x.split('=')));
  c.freq=p.FREQ;c.interval=Number(p.INTERVAL||1);
  const unsupported=Object.keys(p).some(k=>!['FREQ','INTERVAL','BYDAY','BYMONTHDAY','BYSETPOS','COUNT','UNTIL','WKST','BYMONTH'].includes(k));
  let preserve=unsupported||!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(p.FREQ)||(p.WKST&&p.WKST!=='MO');
  if(p.FREQ==='WEEKLY'){if(p.BYDAY)c.days=p.BYDAY.split(',');if(c.days.some(d=>!DAYS.includes(d)))preserve=true;}
  else if(p.FREQ==='MONTHLY'){
   if(p.BYDAY){const m=p.BYDAY.match(/^(-?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/);if(!m||(!m[1]&&!p.BYSETPOS))preserve=true;else{c.monthMode='ordinal';c.ordinal=Number(m[1]||p.BYSETPOS);c.weekday=m[2];if(![1,2,3,4,5,-1].includes(c.ordinal))preserve=true;}}
   if(p.BYMONTHDAY){if(p.BYDAY||!/^([1-9]|[12]\d|3[01])$/.test(p.BYMONTHDAY))preserve=true;else c.monthDay=Number(p.BYMONTHDAY);}
  }else if(p.BYDAY||p.BYSETPOS)preserve=true;
  if(p.BYMONTHDAY&&p.FREQ!=='MONTHLY')preserve=true;
  if(p.BYMONTH){const month=Number((start||'').slice(5,7));if(p.FREQ!=='YEARLY'||p.BYMONTH!==String(month))preserve=true;}
  if(p.BYSETPOS&&!(p.FREQ==='MONTHLY'&&p.BYDAY))preserve=true;
  if(p.COUNT){c.endMode='count';c.count=Number(p.COUNT);}
  if(p.UNTIL){c.endMode='date';const u=p.UNTIL;if(/^\d{8}$/.test(u))c.until=u.slice(0,4)+'-'+u.slice(4,6)+'-'+u.slice(6,8);else{const m=u.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);if(m){c.until=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`));}else preserve=true;}}
  if(preserve){c.preserve=rule;c.freq='preserve';}return c;
 }
 function untilUTC(date,timezone){
  const wall=Date.parse(date+'T23:59:59Z');let value=wall;
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<4;i++){const p=Object.fromEntries(formatter.formatToParts(new Date(value)).map(x=>[x.type,x.value]));const seen=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);const delta=wall-seen;value+=delta;if(!delta)break;}
  return new Date(value).toISOString().replace(/[-:]/g,'').replace('.000','');
 }
 function build(c,timezone='UTC'){
  if(c.freq==='preserve')return c.preserve;if(!c.freq)return '';
  if(!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(c.freq))throw new Error('invalid_recurrence');
  const interval=Number(c.interval);if(!Number.isInteger(interval)||interval<1||interval>10000)throw new Error('invalid_recurrence');
  const p=['FREQ='+c.freq];if(interval!==1)p.push('INTERVAL='+interval);
  if(c.freq==='WEEKLY'){const days=DAYS.filter(d=>(c.days||[]).includes(d));if(!days.length)throw new Error('choose_weekdays');p.push('BYDAY='+days.join(','));}
  if(c.freq==='MONTHLY'){if(c.monthMode==='ordinal'){if(![1,2,3,4,5,-1].includes(Number(c.ordinal))||!DAYS.includes(c.weekday))throw new Error('invalid_recurrence');p.push('BYDAY='+c.ordinal+c.weekday);}else{const day=Number(c.monthDay);if(!Number.isInteger(day)||day<1||day>31)throw new Error('invalid_recurrence');p.push('BYMONTHDAY='+day);}}
  if(c.endMode==='count'){const count=Number(c.count);if(!Number.isInteger(count)||count<1||count>10000)throw new Error('invalid_recurrence');p.push('COUNT='+count);}
  if(c.endMode==='date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(c.until||''))throw new Error('invalid_recurrence');p.push('UNTIL='+untilUTC(c.until,timezone));}
  return p.join(';');
 }
 const api={DAYS,defaults,parse,build};root.CalendarRecurrence=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
