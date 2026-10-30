/* Event surfaces use the existing event API, revisions and private reminder model. */
const EventSurface=(()=>{
 const words={
  ru:{eventDateTime:'Дата и время',eventNotifications:'Уведомления',eventTranslation:'Перевод',eventManualTranslation:'Редактировать ручной перевод',eventAutoTranslation:'Автоматический перевод',eventManual:'Ручной перевод',eventExtra:'Часовой пояс и ссылки',eventOwner:'Чьё событие',eventMore:'Другие действия',eventEdit:'Редактировать',eventNoNotifications:'Выключены',eventNoAdvance:'Без предварительных напоминаний',eventCustom:'Свой интервал',eventMaxReminders:'Выбери до 3 напоминаний',eventTranslationAfterSave:'Перевод обновится после сохранения события.',eventReplaceConsent:'Разрешаю заменить ручные переводы RU/EN',eventReplaceRequired:'Отметь разрешение на замену ручных переводов.',eventTranslationInfo:'Будут заново переведены название и описание на русский и английский.',eventTranslationUnavailable:'Автоперевод сейчас не подключён. Ручной перевод доступен.',eventPendingTranslation:'Перевести после сохранения',eventSource:'Источник',eventViewTranslation:'Ручной перевод',eventDateRange:'Последний день включён',eventSmart:'Умные события и оригинал'},
  en:{eventDateTime:'Date & time',eventNotifications:'Notifications',eventTranslation:'Translation',eventManualTranslation:'Edit manual translation',eventAutoTranslation:'Automatic translation',eventManual:'Manual translation',eventExtra:'Time zone & links',eventOwner:'Whose event',eventMore:'More actions',eventEdit:'Edit event',eventNoNotifications:'Off',eventNoAdvance:'No advance reminders',eventCustom:'Custom interval',eventMaxReminders:'Choose up to 3 reminders',eventTranslationAfterSave:'Translation will refresh after saving the event.',eventReplaceConsent:'Allow replacing manual RU/EN translations',eventReplaceRequired:'Allow replacing manual translations to continue.',eventTranslationInfo:'The title and description will be translated into Russian and English again.',eventTranslationUnavailable:'Automatic translation is not connected. You can still edit translations manually.',eventPendingTranslation:'Translate after saving',eventSource:'Source',eventViewTranslation:'Manual translation',eventDateRange:'Last day is included',eventSmart:'Smart events & original'}
 };
 let language='en',translationRequest=null;
 const labelRow=(key,control)=>`<div class="surface-field">${field(key,control)}</div>`;
 const summary=values=>values.map(n=>n===0?t('atStart'):t('remindBefore')+reminderLabel(n)).join(' · ')||t('eventNoNotifications');
 const name=id=>state.members.find(m=>m.id===id)?.name||ownership(id);
 const owner=id=>id==='both'?state.members.map(m=>m.name).filter(Boolean).join(' & ')||t('both'):name(id);
 function reset(){language=state.me.language==='ru'?'en':'ru';translationRequest=null}
 function form(e){
  const all=e.all_day,last=all?addDays(e.end,-1):e.end.slice(0,10),first=e.start.slice(0,10);
  const dates=dateLabel(first,{day:'numeric',month:'long',year:'numeric'})+(first!==last?' — '+dateLabel(last,{day:'numeric',month:'long',year:'numeric'}):'');
  const tr=e.translations?.[language]||{},manual=tr.manual||['title','description'].some(f=>e.smart?.fields?.[language+'.'+f]?.manual);
  return `<form id="event-form" class="event-form event-surface-form"><div id="form-error" class="error" role="alert"></div>
   <div class="title-field">${field('title',input('title',e.title,'text',`required maxlength="300" placeholder="${t('title')}"`))}</div>
   <div class="surface-field surface-date-field"><span class="surface-caption">${t('eventDateTime')}</span>
    ${button('event-datetime',`<span class="surface-date">${esc(dates)}</span><strong>${all?t('allDay'):esc(e.start.slice(11,16))+' <span aria-hidden="true">—</span> '+esc(e.end.slice(11,16))}</strong><small>${all?t('eventDateRange'):esc(e.timezone)}</small>`,'event-datetime-trigger surface-schedule','data-field="start" aria-haspopup="dialog"')}
    <input type="hidden" name="start" value="${esc(e.start)}"><input type="hidden" name="end" value="${esc(e.end)}">${all?'<input type="hidden" name="all_day" value="1">':''}
   </div>
   <div class="surface-field-pair">${labelRow('category',select('category_id',[['',t('noCategory')],...categories.map(c=>[c.id,catName(c.id)])],e.category_id||''))}${labelRow('eventOwner',select('owner',[[state.me.id,name(state.me.id)],...state.members.filter(m=>m.id!==state.me.id).map(m=>[m.id,m.name]),['both',t('both')]],e.owner))}</div>
   ${labelRow('location',input('location',e.location))}
   ${labelRow('description',`<textarea name="description" rows="3">${esc(e.description)}</textarea>`)}
   <details class="surface-section surface-recurrence" data-panel="repeat" open><summary>${icon('repeat')}<span>${t('repeat')}</span>${icon('down')}</summary>${recurrenceEditor(e)}</details>
   <section class="surface-section surface-notifications">${button('form-reminders',`${icon('bell')}<span><small>${t('eventNotifications')}</small><strong>${esc(summary(e.reminders?.[state.me.id]||[]))}</strong></span>${icon('next')}`,'surface-menu-row','aria-haspopup="dialog"')}<div hidden>${reminderEditor(e.reminders?.[state.me.id]||[])}</div></section>
   <details class="surface-section translation-fields" data-panel="translation" open><summary>${icon('language')}<span>${t('eventTranslation')}</span>${icon('down')}</summary>
    <div class="segment surface-languages">${['ru','en'].map(l=>button('form-translation-language',l==='ru'?'Русский':'English',l===language?'active':'',`data-lang="${l}" aria-pressed="${l===language}"`)).join('')}</div>
    <div class="surface-translation-preview"><small>${t(manual?'eventManual':'eventAutoTranslation')}${tr.stale?' · '+t('stale'):''}</small><strong>${esc(tr.title||e.title)}</strong><p>${esc(tr.description||e.description)}</p></div>
    ${button('form-retranslate',icon('refresh')+t('translateAgain'),'surface-secondary',cfg.integrations?.translation==='configured'?'':'disabled')}
    ${cfg.integrations?.translation==='configured'?'':`<p class="privacy">${t('eventTranslationUnavailable')}</p>`}
    <details class="surface-manual" data-panel="manual"><summary>${icon('edit')}<span>${t('eventManualTranslation')}</span>${icon('down')}</summary>
     ${['ru','en'].map(l=>`<div class="surface-manual-fields" ${l===language?'':'hidden'}><label for="title-${l}">${l.toUpperCase()} · ${t('title')}</label><input id="title-${l}" name="title_${l}" maxlength="300" value="${esc(e.translations?.[l]?.title||'')}"><label for="description-${l}">${t('description')}</label><textarea id="description-${l}" name="description_${l}" rows="3">${esc(e.translations?.[l]?.description||'')}</textarea></div>`).join('')}
    </details>${translationRequest?`<p class="surface-translation-pending" role="status">${t('eventTranslationAfterSave')}</p>`:''}
   </details>
   <details class="surface-section" data-panel="extra"><summary>${icon('globe')}<span>${t('eventExtra')}</span>${icon('down')}</summary>${labelRow('timezone',input('timezone',e.timezone,'text','required list="timezones"'))}${labelRow('links',`<textarea name="links" rows="2">${esc(e.links.join('\n'))}</textarea>`)}</details>
   <details class="surface-section dst-fields" data-panel="dst"><summary>${icon('clock')}<span>${t('repeatedHour')}</span>${icon('down')}</summary><p class="privacy">${t('ambiguous')}</p><div class="fields">${field('start',select('fold',[['','—'],['0',t('firstFold')],['1',t('secondFold')]],e.fold===undefined?'':String(e.fold)))}${field('end',select('end_fold',[['','—'],['0',t('firstFold')],['1',t('secondFold')]],e.end_fold===undefined?'':String(e.end_fold)))}</div></details>
   <button type="submit" class="primary event-form-save">${t('save')}</button>
   <datalist id="timezones">${['Europe/Warsaw','Europe/Amsterdam','Europe/Kyiv','Europe/London','Australia/Melbourne','UTC'].map(v=>`<option value="${v}">`).join('')}</datalist></form>`;
 }
 function detail(e,lang){
  if(!e)return '';
  lang=lang||state.me.language;const tr=e.translations?.[lang],providers=[e.google_links?.length?'Google Calendar':null,e.icloud_links?.length?'Apple Calendar':null].filter(Boolean),links=e.links||[];
  const first=e.all_day?e.start:isoDay(new Date(e.start_utc)),last=e.all_day?addDays(e.end,-1):isoDay(new Date(Date.parse(e.end_utc)-1));
  const dates=dateLabel(first,{weekday:'long',day:'numeric',month:'long',year:'numeric'})+(first!==last?' — '+dateLabel(last,{day:'numeric',month:'long',year:'numeric'}):'');
  const text=tr?.description||e.description,description=e.google_links?.length?readableGoogleDescription(text):text;
  const row=(symbol,label,content,action='')=>{const inside=`${icon(symbol)}<span class="surface-row-copy"><small>${t(label)}</small><span>${content}</span></span>${action?icon('next'):''}`;return action?button(action,inside,'surface-detail-row'): `<div class="surface-detail-row">${inside}</div>`};
  return `<article class="event-detail event-surface-detail"><div class="surface-handle" aria-hidden="true"></div>
   <div class="detail-badges surface-detail-toolbar">${button('status-options',`<span>${t(e.status)}</span>${icon('down')}`,'status-chip','aria-haspopup="dialog" aria-label="'+t('changeStatus')+'"')}${button('back',icon('close'),'surface-close','aria-label="'+t('close')+'"')}</div>
   <div class="surface-detail-meta">${button('category-options',`<span>${esc(catName(e.category_id))}</span>${icon('down')}`,'category-chip',`data-bg="${color(e.category_id)}" aria-label="${esc(t('category')+': '+catName(e.category_id))}" aria-haspopup="dialog"`)}<span class="owner-chip">${esc(owner(e.owner))}</span></div>
   <h1 class="detail-title">${esc(title(e,lang))}</h1>
   <section class="surface-schedule surface-detail-schedule"><span class="surface-date">${esc(dates)}</span><strong>${e.all_day?t('allDay'):esc(time(e))+' <span aria-hidden="true">→</span> '+esc(zoned(e.end_utc,{hour:'2-digit',minute:'2-digit'}))}</strong><small>${e.all_day?'':esc(EventDateTime.durationText((Date.parse(e.end_utc)-Date.parse(e.start_utc))/60000,state.me.language))+' · '}${t('yourTime')} · ${esc(tz())}</small>${!e.all_day&&e.timezone!==tz()?`<div class="source-time">${t('sourceTime')} · ${esc(e.timezone)}<br>${esc(e.start.replace('T',' '))} — ${esc(e.end.replace('T',' '))}</div>`:''}</section>
   ${e.location||links.length?row('pin','location',`${esc(e.location||'')}${links.map(l=>`<a href="${esc(l)}" target="_blank" rel="noreferrer noopener">${esc(l)}</a>`).join('')}`):''}
   ${row('repeat','repeat',esc(recurrenceLabel(e))+(e.rrule?button('other-occurrences',t('otherOccurrences'),'text-button'):''))}
   <section class="detail-reminders">${row('bell','reminders',esc(summary(eventReminderValues(e))),'edit-reminders')}</section>
   ${description?.trim()?`<section class="surface-detail-description description-card"><h3>${t('description')}</h3><p>${esc(description)}</p>${tr?.stale?`<small>${t('stale')}</small>`:''}</section>`:''}
   <p class="surface-credit">${providers.length?esc(providers.join(' + '))+' · '+t('gImportOnly'):'Our Calendar'}${[...(e.google_links||[]),...(e.icloud_links||[])].some(l=>['conflict','remote_deleted'].includes(l.state))?' · '+t('gNeedsDecision'):''}</p>
   ${e.translation_status?.state==='pending'?`<p class="privacy" role="status">${t('translationQueued')}</p>`:e.translation_status?.state==='failed'?`<p class="error">${t('translationFailed')}</p>`:''}
   <details class="surface-smart" data-panel="smart"><summary>${t('eventSmart')}${icon('down')}</summary>${smartDetail()}${cfg.integrations?.translation==='configured'&&Object.values(e.translations||{}).some(v=>v.manual)?button('replace-translations',t('replaceManual'),'text-button danger'):''}</details>
   <div class="detail-actions">${button('edit-event',icon('edit')+t('eventEdit'),'primary header-save')}${button('event-more','•••','surface-more','aria-label="'+t('eventMore')+'" aria-haspopup="dialog"')}</div></article>`;
 }
 function modal(title,content,cls=''){
  const previous=document.activeElement,app=$('#app'),wasInert=app.inert,overflow=document.documentElement.style.overflow;
  const el=document.createElement('div');el.className='modal-backdrop surface-backdrop '+cls;
  el.innerHTML=`<section class="modal surface-modal" role="dialog" aria-modal="true" aria-labelledby="surface-modal-title"><div class="modal-header"><h2 id="surface-modal-title">${esc(title)}</h2><button type="button" data-close aria-label="${t('close')}">${icon('close')}</button></div>${content}</section>`;
  document.body.append(el);app.inert=true;document.documentElement.style.overflow='hidden';
  const close=()=>{el.remove();app.inert=wasInert;document.documentElement.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true})};
  el.addEventListener('click',e=>{if(!busy&&(e.target===el||e.target.closest('[data-close]')))close()});
  el.addEventListener('keydown',e=>{if(e.key==='Escape'&&!busy){e.preventDefault();close()}if(e.key==='Tab'){const nodes=[...el.querySelectorAll('button,input,select,textarea,a[href]')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
  $('[data-close]',el).focus();return {el,close};
 }
 function reminderChoices(values){
  const presets=reminderPresets,custom=values.filter(v=>v>0&&!presets.includes(v));
  const check=(v,text)=>`<label class="surface-check"><input type="checkbox" data-reminder-check="${v}" ${values.includes(v)?'checked':''}><span>${esc(text)}</span></label>`;
  return `<p class="privacy">${t('eventMaxReminders')}</p><div class="surface-check-grid">${presets.map(n=>check(n,t('remindBefore')+reminderLabel(n))).join('')}</div><div class="surface-custom-reminders">${custom.map(customChoice).join('')}</div>${button('surface-add-custom',t('eventCustom'),'text-button')}${check('none',t('eventNoAdvance'))}${check(0,t('atStart'))}`;
 }
 function customChoice(n){const factor=n%1440===0?1440:n%60===0?60:1;return `<div class="surface-custom-choice"><label class="surface-check"><input type="checkbox" data-reminder-custom checked><span>${t('eventCustom')}</span></label><div class="surface-custom-fields"><input type="number" min="1" max="525600" step="1" data-reminder-amount value="${n/factor}" aria-label="${t('reminderAmount')}"><select data-reminder-unit aria-label="${t('reminderUnit')}">${[[1,t('reminderMinutes')],[60,t('reminderHours')],[1440,t('reminderDays')]].map(([v,l])=>opt(String(v),l,String(factor))).join('')}</select></div></div>`}
 function checkedReminders(root){
  const values=$$('[data-reminder-check]:checked',root).map(i=>i.dataset.reminderCheck).filter(v=>v!=='none').map(Number);
  for(const row of $$('.surface-custom-choice',root))if($('[data-reminder-custom]',row).checked){const n=Number($('[data-reminder-amount]',row).value)*Number($('[data-reminder-unit]',row).value);if(!Number.isInteger(n)||n<1||n>525600)throw Error(t('invalidCustomReminder'));values.push(n)}
  if(values.filter(n=>n>0).length>3||new Set(values).size!==values.length)throw Error(t('invalid_reminders'));
  return values;
 }
 function remindersDialog(editing=false){
  if($('.reminder-backdrop'))return;
  if(editing)captureForm();const event=editing?formEvent:currentEvent;if(!event)return;
  const values=editing?event.reminders[state.me.id]:eventReminderValues(event);
  const {el,close}=modal(t(editing?'eventNotifications':'reminders'),`<form class="event-reminder-sheet"><div class="reminder-sheet-body">${reminderChoices(values)}</div><p class="error reminder-sheet-error" role="alert"></p><div class="reminder-sheet-actions"><button type="button" data-close>${t('cancel')}</button><button type="submit" class="primary">${t('save')}</button></div></form>`,'reminder-backdrop');
  const form=$('form',el),error=$('.error',el),none=$('[data-reminder-check=none]',el);
  const update=()=>{none.checked=!$$('[data-reminder-check]:checked',el).some(i=>Number(i.dataset.reminderCheck)>0)&&!$$('[data-reminder-custom]:checked',el).length;for(const row of $$('.surface-custom-choice',el))$$('[data-reminder-amount],[data-reminder-unit]',row).forEach(i=>i.disabled=!$('[data-reminder-custom]',row).checked)};update();
  el.addEventListener('change',e=>{if(busy)return;error.textContent='';if(e.target===none&&none.checked){$$('[data-reminder-check],[data-reminder-custom]',el).filter(i=>i!==none&&i.dataset.reminderCheck!=='0').forEach(i=>i.checked=false)}try{checkedReminders(el)}catch(err){error.textContent=err.message;if(e.target.type==='checkbox'&&e.target.checked&&e.target!==none)e.target.checked=false}update()});
  $('[data-action=surface-add-custom]',el).onclick=()=>{try{const values=checkedReminders(el);if(values.filter(n=>n>0).length>=3)throw Error(t('invalid_reminders'));const n=[45,90,180,360].find(n=>!values.includes(n));$('.surface-custom-reminders',el).insertAdjacentHTML('beforeend',customChoice(n));update();error.textContent='';$$('[data-reminder-amount]',el).at(-1).focus()}catch(err){error.textContent=err.message}};
  form.onsubmit=async e=>{e.preventDefault();if(busy)return;try{const reminders=checkedReminders(el);if(editing){formEvent.reminders={...formEvent.reminders,[state.me.id]:reminders};close();render();$('[data-action=form-reminders]')?.focus({preventScroll:true});return}busy=true;
   const changes={reminders,reminders_v2:true};if(event.rrule)await api('events/'+event.id+'/occurrence','POST',{occurrence:event.occurrence,revision:event.revision,scope:'one',changes});else await api('events/'+event.id,'PATCH',{revision:event.revision,...changes});
   await openEvent(event.id,event.occurrence);close();$('.detail-reminders [data-action=edit-reminders]')?.focus({preventScroll:true});toast(t('saved'));
  }catch(err){error.textContent=err.message}finally{busy=false}};
 }
 function changeLanguage(el){captureForm();language=el.dataset.lang;render()}
 function queueTranslation(){
  captureForm();
  const manual=Object.values(formEvent.translations||{}).some(v=>v.manual)||Object.entries(formEvent.smart?.fields||{}).some(([k,v])=>/\.(title|description)$/.test(k)&&v.manual);
  const {el,close}=modal(t('translateAgain'),`<p class="privacy">${t('eventTranslationInfo')}</p>${manual?`<label class="surface-check"><input type="checkbox" data-overwrite-manual>${t('eventReplaceConsent')}</label>`:''}<p class="error" role="alert"></p><button type="button" class="primary" data-queue-translation>${t('eventPendingTranslation')}</button>`);
  $('[data-queue-translation]',el).onclick=()=>{if(manual&&!$('[data-overwrite-manual]',el).checked){$('.error',el).textContent=t('eventReplaceRequired');return}translationRequest={overwrite_manual:manual};close();render()};
 }
 function more(){const {el,close}=modal(t('eventMore'),button('surface-delete',icon('trash')+t('delete'),'danger full'));$('[data-action=surface-delete]',el).onclick=async()=>{close();if(busy)return;busy=true;try{await deleteCalendarEvent(currentEvent)}catch(err){toast(err.message)}finally{busy=false}}}
 const consumeTranslation=()=>{const pending=translationRequest;translationRequest=null;return pending};
 return {words,form,detail,reset,remindersDialog,changeLanguage,queueTranslation,more,consumeTranslation,summary,checkedReminders};
})();
