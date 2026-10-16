'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tg=window.Telegram?.WebApp;
const words={
ru:{translateAgain:'Перевести заново',replaceManual:'Заменить ручные переводы',replaceManualHelp:'Ручные версии RU/EN будут заменены автоматическим переводом исходного текста.',translationQueued:'Перевод поставлен в очередь',translationFailed:'Перевод не выполнен. Попробуйте заново.',translation_not_configured:'Сервис перевода ещё не настроен.',mySettings:'Мои настройки из архива',recurrenceExceptions:'Исключения повторяющихся событий',preview_required:'Сравните архив с календарём заново: предпросмотр устарел или уже применён.',calendar:'Календарь',categories:'Категории',settings:'Настройки',month:'Месяц',week:'Неделя',day:'День',today:'Сегодня',
subtitle:'Время для вас двоих',search:'Поиск событий',filters:'Фильтры',all:'Все',mine:'Мне',partner:'Партнёру',both:'Обоим',
planned:'Запланировано',done:'Выполнено',cancelled:'Отменено',noCategory:'Без категории',empty:'Здесь пока тихо',emptyHelp:'Добавьте событие — и оно появится у вас обоих.',
newEvent:'Новое событие',editEvent:'Изменить событие',title:'Название',date:'Дата',start:'Начало',end:'Окончание',allDay:'Весь день',
advanced:'Дополнительно',owner:'Для кого',category:'Категория',status:'Статус',location:'Место',description:'Описание',links:'Ссылки (по одной в строке)',
timezone:'Часовой пояс',repeat:'Повторение',none:'Без повторения',daily:'Ежедневно',weekly:'Еженедельно',monthly:'Ежемесячно',yearly:'Ежегодно',custom:'Настроить',
interval:'Каждые N периодов',rule:'Правило RRULE',ruleHelp:'Например: FREQ=MONTHLY;BYDAY=2TU — каждый второй вторник месяца.',
notify_at_start:'Уведомлять в момент начала события',reminders:'Мои напоминания',reminderHelp:'До трёх интервалов. Настройки партнёра независимы.',save:'Сохранить',cancel:'Отмена',back:'Назад',edit:'Изменить',delete:'Удалить',
confirmDelete:'Точно удалить?',deleteForever:'Удалить навсегда',restore:'Восстановить',saved:'Сохранено',overlap:'Внимание: есть пересечение с другим событием.',
language:'Язык',theme:'Тема',light:'Светлая',dark:'Тёмная',system:'Системная',defaults:'Напоминания по умолчанию',
defaultHelp:'Применяются только к новым событиям.',enabled:'Отправлять мои напоминания',botStart:'Чтобы получать уведомления, откройте бота и нажмите «Запустить».',
openBot:'Открыть бота',deliveryOk:'Бот может отправлять сообщения',deliveryError:'Сообщения не доставляются. Откройте бота.',
trash:'Корзина',trashHelp:'Удалённые события хранятся 30 дней.',backup:'Резервная копия',downloadZip:'Скачать ZIP',downloadIcs:'Скачать ICS',
restoreZip:'Восстановить из ZIP',archivePreview:'Предпросмотр восстановления',missing:'Отсутствующие события',differences:'Изменившиеся поля',
applySelected:'Восстановить выбранное',chooseFile:'Выберите ZIP-архив',preview:'Сравнить с календарём',archiveInfo:'Выберите конкретные поля и события. Внешние подключения не восстанавливаются.',
noDifferences:'Отличий нет',current:'Сейчас',archive:'В архиве',invite:'Пригласить партнёра',inviteHelp:'Первый человек, открывший ссылку в Telegram, займёт второе место. После этого заменить его нельзя.',
copy:'Скопировать',copied:'Ссылка скопирована',create:'Создать наш календарь',join:'Присоединиться',welcome:'Наше время. В одном месте.',
welcomeHelp:'Приватный календарь для двух человек. Общие планы, свои часовые пояса и напоминания.',leave:'Выйти из календаря',leaveHelp:'События сохранятся. Вернуться можно только из этого Telegram-аккаунта.',
return:'Вернуться в календарь',left:'Вы вышли из календаря',leftHelp:'Ваше место закреплено за вами. Вы можете вернуться в любой момент.',
deleteCalendar:'Удалить весь календарь',deleteHelp:'Требуется согласие обоих. После него календарь будет закрыт на 30 дней. Перед подтверждением сохраните ZIP.',
approve:'Подтвердить',reject:'Отказаться',deletionPending:'Ожидаем решение партнёра',deletionRequested:'Партнёр предложил удалить календарь',
locked:'Запланировано полное удаление',lockedHelp:'Календарь, настройки и напоминания приостановлены. Любой из вас может отменить удаление.',cancelDeletion:'Отменить удаление',days:'дней',
restoreRequest:'Запрос на восстановление календаря из ZIP',restoreRequestHelp:'Продолжить можно только после согласия обоих исходных участников.',
restoreDeleted:'Восстановить удалённый календарь',fullRestoreInfo:'Загрузите подписанный ZIP исходного календаря. Второй участник должен отдельно подтвердить восстановление.',
newCategory:'Новая категория',name:'Название',color:'Цвет HEX',integrations:'Внешние календари',integrationsInfo:'Google и Apple/iCloud пока не подключены. Интеграции требуют настройки и проверки реальных аккаунтов.',
translations:'Переводы RU / EN',translationHelp:'Ручные версии сохраняются отдельно и не меняются автоматически.',
original:'Исходный текст',stale:'Перевод, возможно, устарел',occurrenceScope:'Как изменить повторяющееся событие?',one:'Только этот экземпляр',following:'Этот и последующие',series:'Вся серия',
sourceTime:'Исходная зона',categoryDelete:'Удалить категорию? События останутся без категории.',loading:'Загрузка…',retry:'Попробовать снова',telegramOnly:'Откройте Our Calendar через Telegram-бота.',
privacy:'События видны обоим участникам. Принадлежность используется только для фильтрации.',demo:'Локальный деморежим · данные тестовые',
ambiguous:'Эта дата попадает на перевод часов. Выберите первый или второй вариант времени.',fold:'При повторении часа',firstFold:'Первый час',secondFold:'Второй час',
error:'Не удалось выполнить действие',invalid_init_data:'Не удалось подтвердить вход Telegram. Закройте и заново откройте Mini App.',expired_init_data:'Время входа истекло. Заново откройте Mini App.',
revision_conflict:'Событие уже изменили. Откройте его заново, чтобы не затереть изменения.',invalid_invite:'Приглашение уже использовано или отозвано.',
member_left:'Сначала вернитесь в календарь.',calendar_locked:'Календарь ожидает удаления.',title_required:'Введите название.',end_must_follow_start:'Окончание должно быть позже начала.',
nonexistent_local_time:'Такого местного времени нет из-за перехода на летнее время.',ambiguous_local_time_choose_fold:'Укажите первый или второй вариант повторяющегося часа в «Дополнительно».',
invalid_reminders:'Выберите не больше трёх напоминаний.',archive_wrong_calendar:'Архив относится к другому календарю.',archive_wrong_pair:'Этот архив доступен только исходной паре.',
invalid_or_unsigned_archive:'Архив повреждён или его подпись не подтверждена.',pair_has_another_calendar:'Один из участников уже состоит в другом календаре.',both_must_return:'Для подтверждения оба участника должны вернуться.',
pair_required:'Сначала пригласите второго участника.',too_many_occurrences_reduce_range:'Слишком много повторений. Уменьшите период.',no_calendar:'Сначала создайте календарь.',
rate_limited:'Слишком много запросов. Подождите немного.',expired_session:'Сессия истекла. Откройте приложение заново.',restored:'Восстановлено',waiting:'Ожидаем подтверждение партнёра'},
en:{translateAgain:'Translate again',replaceManual:'Replace manual translations',replaceManualHelp:'Manual RU/EN text will be replaced by an automatic translation of the original.',translationQueued:'Translation queued',translationFailed:'Translation failed. Try again.',translation_not_configured:'Translation service is not configured yet.',mySettings:'My settings from the archive',recurrenceExceptions:'Recurring event exceptions',preview_required:'Compare the archive again: the preview expired or was already used.',calendar:'Calendar',categories:'Categories',settings:'Settings',month:'Month',week:'Week',day:'Day',today:'Today',subtitle:'Time for the two of you',
search:'Search events',filters:'Filters',all:'All',mine:'Mine',partner:'Partner',both:'Both',planned:'Planned',done:'Done',cancelled:'Cancelled',noCategory:'Uncategorized',
empty:'A little space for your plans',emptyHelp:'Add an event and it will appear for both of you.',newEvent:'New event',editEvent:'Edit event',title:'Title',date:'Date',start:'Start',end:'End',allDay:'All day',
advanced:'More options',owner:'For whom',category:'Category',status:'Status',location:'Location',description:'Description',links:'Links (one per line)',timezone:'Timezone',repeat:'Repeat',
none:'Does not repeat',daily:'Daily',weekly:'Weekly',monthly:'Monthly',yearly:'Yearly',custom:'Custom',interval:'Every N periods',rule:'RRULE',ruleHelp:'Example: FREQ=MONTHLY;BYDAY=2TU — every second Tuesday of the month.',
notify_at_start:'Notify me when an event starts',reminders:'My reminders',reminderHelp:'Up to three. Your partner has independent settings.',save:'Save',cancel:'Cancel',back:'Back',edit:'Edit',delete:'Delete',confirmDelete:'Delete this event?',deleteForever:'Delete permanently',restore:'Restore',saved:'Saved',overlap:'This event overlaps another event.',
language:'Language',theme:'Theme',light:'Light',dark:'Dark',system:'System',defaults:'Default reminders',defaultHelp:'Only applied to new events.',enabled:'Send my reminders',
botStart:'To receive messages, open the bot and press Start.',openBot:'Open bot',deliveryOk:'The bot can send messages',deliveryError:'Messages cannot be delivered. Open the bot.',
trash:'Trash',trashHelp:'Deleted events are kept for 30 days.',backup:'Backup',downloadZip:'Download ZIP',downloadIcs:'Download ICS',restoreZip:'Restore from ZIP',archivePreview:'Restoration preview',
missing:'Missing events',differences:'Changed fields',applySelected:'Restore selected',chooseFile:'Select ZIP archive',preview:'Compare with calendar',archiveInfo:'Select individual fields and events. External connections will not be restored.',noDifferences:'No differences',current:'Current',archive:'Archive',
invite:'Invite your partner',inviteHelp:'The first person to open this link in Telegram will take the second place. The pair is then permanent.',copy:'Copy',copied:'Link copied',create:'Create our calendar',join:'Join calendar',welcome:'Your time. Together.',
welcomeHelp:'A private calendar for two. Shared plans, individual timezones and reminders.',leave:'Leave calendar',leaveHelp:'Events will stay. You can only return with this Telegram account.',return:'Return to calendar',left:'You left the calendar',leftHelp:'Your place is reserved. You can return at any time.',
deleteCalendar:'Delete entire calendar',deleteHelp:'Both participants must agree. The calendar will then be locked for 30 days. Download a ZIP first.',approve:'Approve',reject:'Reject',deletionPending:'Waiting for your partner',deletionRequested:'Your partner requested calendar deletion',
locked:'Calendar scheduled for deletion',lockedHelp:'Calendar access, settings and reminders are paused. Either participant can cancel.',cancelDeletion:'Cancel deletion',days:'days',restoreRequest:'Calendar restoration requested',restoreRequestHelp:'Both original participants must explicitly agree.',
restoreDeleted:'Restore a deleted calendar',fullRestoreInfo:'Upload a signed ZIP of the original calendar. Your partner must approve separately.',newCategory:'New category',name:'Name',color:'HEX color',integrations:'External calendars',integrationsInfo:'Google and Apple/iCloud are not connected yet. Integrations need configuration and real-account testing.',
translations:'RU / EN translations',translationHelp:'Manual versions are stored independently and never changed automatically.',original:'Original text',stale:'Translation may be outdated',occurrenceScope:'Which recurring events?',one:'This event',following:'This and following',series:'Entire series',
sourceTime:'Original timezone',categoryDelete:'Delete category? Events will become uncategorized.',loading:'Loading…',retry:'Try again',telegramOnly:'Open Our Calendar through your Telegram bot.',privacy:'Both participants can see all events. Ownership is only used for filters.',demo:'Local demo · test data',
ambiguous:'This date includes a clock change. Choose the first or second occurrence.',fold:'When an hour repeats',firstFold:'First occurrence',secondFold:'Second occurrence',
error:'Could not complete this action',invalid_init_data:'Telegram login could not be verified. Reopen the Mini App.',expired_init_data:'Telegram login expired. Reopen the Mini App.',revision_conflict:'The event has changed. Reopen it to avoid overwriting changes.',invalid_invite:'This invitation has been used or revoked.',member_left:'Return to your calendar first.',calendar_locked:'Calendar is awaiting deletion.',title_required:'Enter a title.',end_must_follow_start:'End must be after start.',nonexistent_local_time:'This local time does not exist because of daylight saving time.',ambiguous_local_time_choose_fold:'Select the first or second occurrence of the hour under More options.',invalid_reminders:'Choose up to three reminders.',archive_wrong_calendar:'This archive belongs to a different calendar.',archive_wrong_pair:'Only the original pair can use this archive.',invalid_or_unsigned_archive:'Archive is damaged or its signature is invalid.',pair_has_another_calendar:'One participant already has another calendar.',both_must_return:'Both participants must return before approving.',pair_required:'Invite your partner first.',too_many_occurrences_reduce_range:'Too many occurrences. Select a shorter period.',no_calendar:'Create a calendar first.',rate_limited:'Too many requests. Please wait.',expired_session:'Session expired. Reopen the Mini App.',restored:'Restored',waiting:'Waiting for your partner'}
};
Object.assign(words.ru,{next:'Вперёд',close:'Закрыть',resetFilters:'Сбросить',results:'найдено',more:'ещё',yourTime:'Ваше время',noAllDay:'Нет событий на весь день',justYou:'Только для вас',sharedData:'Общие данные',leaveOrDelete:'Выход и удаление',pairTitle:'Вы и ваш партнёр',seats:'участников',sharedCategories:'Общие для вас двоих',notConnected:'Не подключено',notAvailable:'Пока недоступно',markDone:'Выполнено',cancelEvent:'Отменить событие',resumeEvent:'Запланировать',personalReminders:'Только ваши настройки',partnerReminders:'У партнёра свои напоминания',backupExport:'Резервные копии и экспорт',defaultIntervals:'Заранее',repeatedHour:'Переход на зимнее время',showTranslations:'Редактировать переводы',clearSearch:'Очистить поиск',connectedCalendars:'Ваши внешние календари'});
Object.assign(words.en,{next:'Next',close:'Close',resetFilters:'Reset filters',results:'results',more:'more',yourTime:'Your time',noAllDay:'No all-day events',justYou:'Just for you',sharedData:'Shared data',leaveOrDelete:'Leave or delete',pairTitle:'You & your partner',seats:'seats',sharedCategories:'Shared by both of you',notConnected:'Not connected',notAvailable:'Not available yet',markDone:'Mark done',cancelEvent:'Cancel event',resumeEvent:'Mark planned',personalReminders:'Your settings only',partnerReminders:'Your partner has their own reminders',backupExport:'Backup & export',defaultIntervals:'In advance',repeatedHour:'When the clocks go back',showTranslations:'Edit translations',clearSearch:'Clear search',connectedCalendars:'Your connected calendars'});
const icons={calendar:'<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',categories:'<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',search:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',filters:'<path d="M4 6h16M7 12h10M10 18h4"/>',prev:'<path d="M15 5l-7 7 7 7"/>',next:'<path d="M9 5l7 7-7 7"/>',plus:'<path d="M12 5v14M5 12h14"/>',repeat:'<path d="M4 8h15l-3-3M20 16H5l3 3M20 8v3M4 16v-3"/>',check:'<path d="M5 12l4 4L19 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z"/><circle cx="12" cy="10" r="2"/>',trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',archive:'<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M10 12h4"/>',close:'<path d="M6 6l12 12M6 18L18 6"/>'};
const icon=name=>`<svg class="svg-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.calendar}</svg>`;
const radioSegment=(name,items,value)=>`<div class="segment radio-segment" role="group" aria-label="${esc(t(name))}">${items.map(([v,l])=>`<label><input type="radio" name="${name}" value="${esc(v)}" ${v===value?'checked':''}><span>${esc(l)}</span></label>`).join('')}</div>`;
let state=null,cfg={},events=[],categories=[],tab='calendar',page='main',selected='',view='month',query='',showSearch=false,showFilters=false;
let filter={owner:'',category:'',status:''},currentEvent=null,formEvent=null,formScope='all',archiveData=null,previewData=null,inviteUrl='';
let token='',busy=false,fetchVersion=0,detailLanguage='';
const t=k=>(words[state?.me?.language||'ru'][k]||words.en[k]||k);
const locale=()=>state?.me?.language==='en'?'en-GB':'ru-RU';
const tz=()=>state?.me?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
const zoned=(value,options={})=>new Intl.DateTimeFormat(locale(),{timeZone:tz(),...options}).format(new Date(value));
const isoDay=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:tz(),year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
const addDays=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const dateLabel=(s,options={})=>new Intl.DateTimeFormat(locale(),{timeZone:'UTC',...options}).format(new Date(s+'T12:00:00Z'));
const monthDays=()=>{const d=new Date(selected.slice(0,7)+'-01T12:00:00Z');const offset=(d.getUTCDay()+6)%7;const count=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();const start=addDays(d.toISOString().slice(0,10),-offset);return Array.from({length:Math.ceil((offset+count)/7)*7},(_,i)=>addDays(start,i))};
const weekDays=()=>{const dow=(new Date(selected+'T12:00:00Z').getUTCDay()+6)%7;const first=addDays(selected,-dow);return Array.from({length:7},(_,i)=>addDays(first,i))};
const cat=id=>categories.find(c=>c.id===id)||{name:t('noCategory'),color:'#888888'};
const catName=id=>{const c=cat(id);return c.translations?.[state.me.language]||c.name};
const title=e=>e.translations?.[state.me.language]?.title||e.title;
const description=e=>e.translations?.[state.me.language]?.description||e.description;
const ownership=id=>id==='both'?t('both'):id===state.me.id?t('mine'):t('partner');
const color=id=>cat(id).color;
const ink=hex=>{const v=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2]>.4?'#201929':'#ffffff'};
const opt=(value,text,chosen)=>`<option value="${esc(value)}" ${value===chosen?'selected':''}>${esc(text)}</option>`;
const button=(action,text,cls='',attrs='')=>`<button type="button" data-action="${action}" class="${cls}" ${attrs}>${text}</button>`;
const field=(label,content)=>{const name=content.match(/name="([^"]+)"/)?.[1];return `<div class="field"><label ${name?'for="field-'+name+'"':''}>${t(label)}</label>${name?content.replace('name="'+name+'"','id="field-'+name+'" name="'+name+'"'):content}</div>`};
const input=(name,value='',type='text',attrs='')=>`<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}>`;
const select=(name,items,value)=>`<select name="${name}" aria-label="${esc(t(name))}">${items.map(([v,l])=>opt(v,l,value)).join('')}</select>`;
const empty=()=>`<div class="empty"><div class="empty-symbol">◌</div><h3>${t('empty')}</h3><p>${t('emptyHelp')}</p></div>`;
const time=e=>e.all_day?t('allDay'):zoned(e.start_utc||e.start,{hour:'2-digit',minute:'2-digit'});
const eventDay=e=>e.all_day?e.start:isoDay(new Date(e.start_utc));
const onDay=(e,d)=>e.all_day?e.start<=d&&e.end>d:eventDay(e)<=d&&isoDay(new Date(new Date(e.end_utc).getTime()-1))>=d;
const eventList=items=>items.length?items.map(e=>`<button class="event ${e.status!=='planned'?'faded':''}" data-action="event" data-id="${esc(e.id)}" data-occ="${esc(e.occurrence||'')}"><span class="stripe" data-bg="${esc(color(e.category_id))}"></span><span class="event-time">${query?`${esc(dateLabel(eventDay(e),{day:'numeric',month:'short'}))}`:esc(time(e))}${!query&&!e.all_day?`<small>${esc(zoned(e.end_utc,{hour:'2-digit',minute:'2-digit'}))}</small>`:''}</span><span class="grow"><span class="event-title ${e.status==='cancelled'?'struck':''}">${e.status==='done'?'✓ ':''}${esc(title(e))}</span><small>${esc(catName(e.category_id))} · ${ownership(e.owner)}${e.rrule?' · ↻':''}${e.status!=='planned'?' · '+t(e.status):''}${query?' · '+esc(time(e)):''}</small>${e.location?`<small>${esc(e.location)}</small>`:''}</span><span class="muted">›</span></button>`).join(''):empty();
function toast(message){const el=$('#toast');el.textContent=message;el.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.style.display='none',4000)}
async function api(path,method='GET',body=null,raw=false){
 const headers={'Authorization':'Bearer '+token};if(body!==null)headers['Content-Type']='application/json';
 const response=await fetch('/api/'+path,{method,headers,body:body!==null?JSON.stringify(body):undefined});
 if(!response.ok){let e;try{e=await response.json()}catch{e={error:'error'}};const err=new Error(t(e.error)||t('error'));err.code=e.error;throw err}
 return raw?response.blob():response.json();
}
function applyTheme(){const theme=state?.me.theme||'system';document.body.classList.toggle('dark',theme==='dark'||(theme==='system'&&matchMedia('(prefers-color-scheme:dark)').matches));document.documentElement.lang=state?.me.language||'ru'}
function paint(){
 const dark=document.body.classList.contains('dark');
 $$('[data-bg]').forEach(el=>{el.style.backgroundColor=el.dataset.bg;if(el.classList.contains('event-bar')||el.classList.contains('time-event')||el.classList.contains('category-chip')){el.style.backgroundColor=`color-mix(in srgb, ${el.dataset.bg} ${dark?'28':'22'}%, var(--card))`;el.style.color=`color-mix(in srgb, ${el.dataset.bg} ${dark?'45':'65'}%, ${dark?'white':'black'})`}});
 $$('[data-top]').forEach(el=>{el.style.top=el.dataset.top+'px';el.style.height=el.dataset.height+'px';el.style.left=`calc(54px + (100% - 54px) * ${el.dataset.lane} / ${el.dataset.lanes})`;el.style.width=`calc((100% - 54px) / ${el.dataset.lanes})`});$$('.hour').forEach(el=>el.style.top=el.dataset.hour*70+'px');
 if($('.days'))$('.days').style.gridTemplateRows=`repeat(${monthDays().length/7},minmax(0,1fr))`;
}
function header(){
 const sub=page!=='main',form=page==='form',active=state.calendar?.active;
 const left=sub?button('back',`${icon('prev')}${t(form?'cancel':'back')}`,'header-back'):tg?.initData?button('close-app',t('close'),'header-back'):'';
 const right=form?`<button type="submit" form="event-form" class="header-save">${t('save')}</button>`:page==='detail'?button('edit-event',t('edit'),'header-save'):active?button('tab',icon('settings'),'icon','data-tab="settings" aria-label="'+t('settings')+'"'):'';
 return `<header class="header ${tg?.initData&&!sub?'telegram-native':''}"><div class="header-side">${left}</div><div class="header-title">${form?t(currentEvent?'editEvent':'newEvent'):'Our Calendar'}${!form?'<small>mini app</small>':''}</div><div class="header-side right">${right}</div></header>`;
}
function navigation(){return `<nav class="bottom-nav" aria-label="${esc(t('calendar'))}">${['calendar','categories','settings'].map(id=>`<button type="button" data-action="tab" data-tab="${id}" class="${tab===id?'active':''}" ${tab===id?'aria-current="page"':''}>${icon(id)}<span>${t(id)}</span></button>`).join('')}</nav>`}
function demo(){return cfg.demo?`<div class="demo">${t('demo')}<select id="demo-user" aria-label="Demo account">${['1','2','3'].map(x=>opt(x,'User '+x,state?.me.id)).join('')}</select></div>`:''}
function render(){
 applyTheme();let html='';
 if(!state)return;
 if(state.me.choose_language){$('#app').innerHTML=`<main class="shell">${header()}<div class="card"><h2>Выберите язык · Choose language</h2>${button('choose-language','Русский','primary full','data-lang="ru"')}<p></p>${button('choose-language','English','full','data-lang="en"')}</div></main>`;return}
 if(state.calendar?.state==='pending_delete'){
  const days=Math.max(0,Math.ceil((new Date(state.calendar.delete_at)-Date.now())/86400000));
  html=`<div class="locked card"><h1>${t('locked')}</h1><div class="countdown">${days} ${t('days')}</div><p>${t('lockedHelp')}</p>${button('cancel-deletion',t('cancelDeletion'),'primary full')}</div>`;
  $('#app').innerHTML=demo()+`<main class="shell">${header()}${html}</main>`;return;
 }
 if(!state.calendar){
  html=`<div class="card locked"><h1>${t('welcome')}</h1><p class="muted">${t('welcomeHelp')}</p>${button('create',t('create'),'primary full')}<p class="privacy">${t('privacy')}</p></div>`;
  for(const r of state.restores||[]) html+=`<div class="card"><h2>${t('restoreRequest')}</h2><p>${t('restoreRequestHelp')}</p>${r.votes.includes(state.me.id)?`<p class="muted">${t('waiting')}</p>`:button('approve-restore',t('approve'),'primary',`data-id="${esc(r.id)}"`)} ${button('reject-restore',t('reject'),'danger',`data-id="${esc(r.id)}"`)}</div>`;
  html+=`<div class="card"><h2>${t('restoreDeleted')}</h2><p class="muted">${t('fullRestoreInfo')}</p><input id="deleted-archive" type="file" accept=".zip,application/zip" aria-label="${t('chooseFile')}">${button('request-restore',t('restore'),'full')}</div>`;
 }else if(!state.calendar.active){html=`<div class="locked card"><h1>${t('left')}</h1><p>${t('leftHelp')}</p>${button('return',t('return'),'primary full')}</div>`}
 else if(page==='form')html=eventForm();
 else if(page==='detail')html=detail();
 else if(page==='trash')html=trashPage();
 else if(page==='backup')html=backupPage();
 else if(tab==='calendar')html=calendarPage();
 else if(tab==='categories')html=categoriesPage();
 else html=settingsPage();
 const active=state.calendar?.active;
 document.body.dataset.page=page;document.body.dataset.tab=tab;document.body.classList.toggle('calendar-screen',Boolean(active&&tab==='calendar'&&page==='main'&&!showSearch));
 $('#app').innerHTML=demo()+`<main class="shell ${page==='main'?'main-screen':'sub-screen'} ${tab==='calendar'&&page==='main'&&!showSearch?'calendar-shell':''}">${header()}${html}</main>`+(active&&page==='main'?navigation():'')+(active&&tab==='calendar'&&page==='main'&&!showSearch?button('new',icon('plus'),'fab','aria-label="'+t('newEvent')+'"'):'');
 paint();
 if(page==='main'&&view==='day'&&tab==='calendar'&&!query){const timeline=$('.timeline');if(timeline)timeline.scrollTop=7*70-20}
}
function filterControls(){return `<div class="filters">${select('filter-owner',[['',t('owner')+': '+t('all')],[state.me.id,t('mine')],[(state.members||[]).find(x=>x.id!==state.me.id)?.id||'partner',t('partner')],['both',t('both')]],filter.owner)}${select('filter-category',[['',t('categories')],['none',t('noCategory')],...categories.map(c=>[c.id,catName(c.id)])],filter.category)}${select('filter-status',[['',t('status')+': '+t('all')],...['planned','done','cancelled'].map(x=>[x,t(x)])],filter.status)}</div>`}
function calendarPage(){
 const heading=view==='day'?dateLabel(selected,{weekday:'short',day:'numeric',month:'long'}):dateLabel(selected,{month:'long',year:'numeric'});
 let html='';
 if(showSearch){
  html=`<section class="search-page"><div class="search-box">${icon('search')}<input id="search" type="search" value="${esc(query)}" placeholder="${t('search')}" aria-label="${t('search')}">${button(query?'clear-search':'search',icon('close'),'icon',`aria-label="${t(query?'clearSearch':'close')}"`)}</div>${filterControls()}<div class="search-summary"><span>${events.length} ${t('results')}</span>${button('reset-filters',t('resetFilters'),'text-button')}</div>`;
  let previous='';for(const e of events){const m=eventDay(e).slice(0,7);if(m!==previous){html+=`<h3 class="section-label">${esc(dateLabel(m+'-01',{month:'long',year:'numeric'}))}</h3>`;previous=m}html+=eventList([e])}
  return html+(events.length?'':empty())+'</section>';
 }
 html=`<section class="calendar-controls"><div class="calendar-heading">${button('prev',icon('prev'),'icon',`aria-label="${t('back')}"`)}<div class="grow"><h1 class="month-title">${esc(heading)}</h1>${view==='day'?`<small>${t('yourTime')} · ${esc(tz())}</small>`:''}</div>${button('next',icon('next'),'icon',`aria-label="${t('next')}"`)}${button('search',icon('search'),'icon',`aria-label="${t('search')}"`)}${button('filters',icon('filters'),`icon ${showFilters?'selected':''}`,`aria-label="${t('filters')}" aria-expanded="${showFilters}"`)}</div><div class="calendar-view-row"><div class="segment" role="group" aria-label="${t('calendar')}">${['month','week','day'].map(v=>button('view',t(v),v===view?'active':'',`data-view="${v}" aria-pressed="${v===view}"`)).join('')}</div>${button('today',t('today'),'today-btn')}</div>${showFilters?filterControls():''}</section>`;
 if(view==='month'){
 const days=monthDays(),weekday=Array.from({length:7},(_,i)=>dateLabel(addDays('2026-10-12',i),{weekday:'short'}));
 html+=`<div class="month"><div class="weekdays">${weekday.map(x=>`<div>${esc(x)}</div>`).join('')}</div><div class="days">${days.map(d=>{const entries=events.filter(e=>onDay(e,d));return `<div class="day ${d.slice(0,7)!==selected.slice(0,7)?'outside':''} ${d===isoDay()?'today':''}" data-action="date" data-date="${d}" role="button" tabindex="0" aria-label="${dateLabel(d,{day:'numeric',month:'long'})}"><div class="day-number">${Number(d.slice(-2))}</div>${entries.slice(0,3).map(e=>{const first=eventDay(e)===d,last=e.all_day?addDays(e.end,-1)===d:isoDay(new Date(new Date(e.end_utc).getTime()-1))===d;return `<button class="event-bar ${e.status!=='planned'?'faded':''} ${e.status==='cancelled'?'struck':''} ${!first?'continues-left':''} ${!last?'continues-right':''}" data-bg="${color(e.category_id)}" data-action="event" data-id="${e.id}" data-occ="${esc(e.occurrence)}" aria-label="${esc(title(e))}">${e.status==='done'?'✓ ':''}${first||new Date(d+'T12:00:00Z').getUTCDay()===1?esc(title(e)):'&nbsp;'}</button>`}).join('')}${entries.length>3?`<div class="more">+${entries.length-3} ${t('more')}</div>`:''}</div>`}).join('')}</div></div>`;
 }else if(view==='week'){
 const daily=events.filter(e=>onDay(e,selected));
 html+=`<div class="week-strip">${weekDays().map(d=>button('week-date',`${esc(dateLabel(d,{weekday:'short'}))}<span class="date-number">${Number(d.slice(-2))}</span>`,`week-date ${d===selected?'selected':''} ${d===isoDay()?'today':''}`,`data-date="${d}" aria-pressed="${d===selected}"`)).join('')}</div><div class="agenda"><div class="agenda-heading"><h2>${esc(dateLabel(selected,{weekday:'long',day:'numeric',month:'long'}))}</h2><small>${daily.length}</small></div>${eventList(daily)}</div>`;
 }else html+=timeline();
 return html;
}
function timeline(){
 const daily=events.filter(e=>onDay(e,selected)),all=daily.filter(e=>e.all_day),timed=daily.filter(e=>!e.all_day);
 let html=`<div class="all-day-row"><span>${t('allDay')}</span><div>${all.length?eventList(all):`<small>${t('noAllDay')}</small>`}</div></div>`;
 const minute=iso=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:tz(),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));return Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value)};
 const items=timed.map(e=>({event:e,start:eventDay(e)<selected?0:minute(e.start_utc),end:isoDay(new Date(e.end_utc))>selected?1440:minute(e.end_utc)})).sort((a,b)=>a.start-b.start||b.end-a.end);
 const groups=[];for(const item of items){let group=groups.at(-1);if(!group||item.start>=group.end){group={end:item.end,items:[],lanes:[]};groups.push(group)}group.end=Math.max(group.end,item.end);let lane=group.lanes.findIndex(end=>end<=item.start);if(lane<0)lane=group.lanes.length;group.lanes[lane]=item.end;item.lane=lane;group.items.push(item)}
 html+=`<div class="timeline"><div class="timeline-inner">${Array.from({length:24},(_,i)=>`<div class="hour" data-hour="${i}"><span>${String(i).padStart(2,'0')}:00</span></div>`).join('')}${groups.flatMap(g=>g.items.map(x=>{const e=x.event;return `<button class="time-event ${e.status!=='planned'?'faded':''}" data-bg="${color(e.category_id)}" data-top="${x.start/60*70}" data-height="${Math.max(28,(x.end-x.start)/60*70)}" data-lane="${x.lane}" data-lanes="${g.lanes.length}" data-action="event" data-id="${e.id}" data-occ="${esc(e.occurrence)}">${e.status==='done'?'✓ ':e.status==='cancelled'?'⊘ ':''}${esc(title(e))}<small>${esc(time(e))}–${esc(zoned(e.end_utc,{hour:'2-digit',minute:'2-digit'}))}</small></button>`})).join('')}</div></div>`;
 return html;
}
function reminderChoices(values,name='reminder'){return `<div class="reminders">${[[1440,'24 h'],[720,'12 h'],[120,'2 h'],[60,'1 h'],[30,'30 min'],[15,'15 min']].map(([n,l])=>`<label><input type="checkbox" name="${name}" value="${n}" ${values.includes(n)?'checked':''}>${l}</label>`).join('')}</div>`}
function eventForm(){
 const e=formEvent,all=e.all_day,repeat=e.rrule?((/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(e.rrule))?e.rrule.split('=')[1]:'custom'):'';
 const row=(label,content)=>`<div class="form-row">${field(label,content)}</div>`;
 return `<form id="event-form" class="event-form"><div id="form-error" class="error" role="alert"></div><section class="form-group basic-fields"><div class="title-field">${field('title',input('title',e.title,'text',`required maxlength="300" placeholder="${t('title')}"`))}</div><label class="switch-row">${t('allDay')}<input type="checkbox" role="switch" name="all_day" ${all?'checked':''}></label>${row('start',input('start',all?e.start:e.start.slice(0,16),all?'date':'datetime-local','required'))}${row('end',input('end',all?e.end:e.end.slice(0,16),all?'date':'datetime-local','required'))}</section><details class="advanced-section"><summary>${t('advanced')}<span>⌃</span></summary><section class="form-group">${row('owner',radioSegment('owner',[[state.me.id,t('mine')],...state.members.filter(x=>x.id!==state.me.id).map(x=>[x.id,t('partner')]),['both',t('both')]],e.owner))}${row('category',select('category_id',[['',t('noCategory')],...categories.map(c=>[c.id,catName(c.id)])],e.category_id||''))}${row('timezone',input('timezone',e.timezone,'text','required list="timezones"'))}${row('repeat',select('repeat',[['',t('none')],['DAILY',t('daily')],['WEEKLY',t('weekly')],['MONTHLY',t('monthly')],['YEARLY',t('yearly')],['custom',t('custom')]],repeat))}<div class="custom-rule ${repeat==='custom'?'':'hidden'}">${field('rule',input('rrule',e.rrule))}<small>${t('ruleHelp')}</small></div></section><section class="form-group">${row('location',input('location',e.location))}<div class="form-note">${field('links',`<textarea name="links" rows="2">${esc(e.links.join('\n'))}</textarea>`)}</div><div class="form-note">${field('description',`<textarea name="description" rows="3">${esc(e.description)}</textarea>`)}</div></section><details class="translation-fields"><summary>${t('showTranslations')}</summary><section class="form-group"><p class="privacy">${t('translationHelp')}</p>${['ru','en'].map(lang=>`<div class="field"><label for="title-${lang}">${lang.toUpperCase()} · ${t('title')}</label><input id="title-${lang}" name="title_${lang}" value="${esc(e.translations?.[lang]?.title||'')}"><label for="description-${lang}">${lang.toUpperCase()} · ${t('description')}</label><textarea id="description-${lang}" name="description_${lang}">${esc(e.translations?.[lang]?.description||'')}</textarea></div>`).join('')}</section></details><details class="dst-fields"><summary>${t('repeatedHour')}</summary><p class="muted">${t('ambiguous')}</p><div class="fields">${field('start',select('fold',[['','—'],['0',t('firstFold')],['1',t('secondFold')]],e.fold===undefined?'':String(e.fold)))}${field('end',select('end_fold',[['','—'],['0',t('firstFold')],['1',t('secondFold')]],e.end_fold===undefined?'':String(e.end_fold)))}</div></details><section class="form-group reminder-group"><h3>${t('reminders')}</h3>${reminderChoices(e.reminders?.[state.me.id]||[])}<p class="privacy">${t('reminderHelp')}</p></section></details><datalist id="timezones">${['Europe/Warsaw','Europe/Amsterdam','Europe/Kyiv','Europe/London','Australia/Melbourne','UTC'].map(v=>`<option value="${v}">`).join('')}</datalist></form>`;
}
function detail(){
 const e=currentEvent;if(!e)return '';
 const lang=detailLanguage||state.me.language,tr=e.translations?.[lang];
 const when=e.all_day?dateLabel(e.start,{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+t('allDay'):`${zoned(e.start_utc,{weekday:'short',day:'numeric',month:'long'})} · ${time(e)} – ${zoned(e.end_utc,{hour:'2-digit',minute:'2-digit'})}`;
 const content=tr?.description||e.description;
 return `<article class="event-detail"><div class="detail-badges"><span class="category-chip" data-bg="${color(e.category_id)}">${esc(catName(e.category_id))}</span><span class="status-chip">${t(e.status)}</span><span class="owner-chip">${ownership(e.owner)}</span></div><h1 class="detail-title">${esc(tr?.title||e.title)}</h1><section class="form-group"><div class="detail-block with-icon">${icon('clock')}<div><strong>${esc(when)}</strong><small>${t('yourTime')} · ${esc(tz())}</small>${!e.all_day&&e.timezone!==tz()?`<div class="source-time"><span>${t('sourceTime')}</span><br>${esc(e.start.replace('T',' '))} → ${esc(e.end.replace('T',' '))}<br>${esc(e.timezone)}</div>`:''}</div></div>${e.rrule?`<div class="detail-block with-icon">${icon('repeat')}<div><span class="muted">${t('repeat')}</span><p>${esc(e.rrule)}</p></div></div>`:''}</section>${e.location||e.links.length?`<section class="form-group"><div class="detail-block with-icon">${icon('pin')}<div><h3>${t('location')}</h3>${e.location?`<p>${esc(e.location)}</p>`:''}${e.links.map(l=>`<p><a href="${esc(l)}" target="_blank" rel="noreferrer noopener">${esc(l)}</a></p>`).join('')}</div></div></section>`:''}${content||Object.keys(e.translations||{}).length?`<section class="form-group description-card"><div class="row spread"><h3>${t('description')}</h3><div class="segment language-segment">${['en','ru'].map(l=>button('detail-language',l.toUpperCase(),lang===l?'active':'',`data-lang="${l}" aria-pressed="${lang===l}"`)).join('')}</div></div><p>${esc(content)}</p>${tr?.stale?`<small>${t('stale')}</small>`:''}${cfg.integrations?.translation==='configured'?button('translate-event',t('translateAgain'),'text-button'):''}</section>`:''}<section class="form-group"><div class="detail-block"><div class="row spread"><h3>${t('reminders')}</h3>${button('edit-event',t('edit'),'text-button')}</div><small>${t('personalReminders')}</small><p>${state.me.notify_at_start!==false?esc(t('notify_at_start'))+'<br>':''}${(e.reminders[state.me.id]||[]).map(x=>x>=60?x/60+' h':x+' min').join(' · ')||'—'}</p><small>${t('partnerReminders')}</small></div></section>${e.translation_status?.state==='pending'?`<p class="privacy">${t('translationQueued')}</p>`:e.translation_status?.state==='failed'?`<p class="error">${t('translationFailed')}</p>`:''}${cfg.integrations?.translation==='configured'&&Object.values(e.translations||{}).some(v=>v.manual)?button('replace-translations',t('replaceManual'),'text-button danger'):''}<div class="detail-actions">${button('set-status',t(e.status==='done'?'resumeEvent':'markDone'),'soft-button',`data-status="${e.status==='done'?'planned':'done'}"`)}${button('set-status',t(e.status==='cancelled'?'resumeEvent':'cancelEvent'),'soft-button',`data-status="${e.status==='cancelled'?'planned':'cancelled'}"`)}${button('delete-event',t('delete'),'danger destructive')}</div></article>`;
}
function categoriesPage(){return `<div class="page-title-row"><h1>${t('categories')}</h1>${button('new-category','+ '+t('newCategory'),'text-button')}</div><div class="categories-grid form-group">${categories.map(c=>`<button class="category-card" type="button" data-action="edit-category" data-id="${c.id}"><span class="dot" data-bg="${c.color}"></span><span class="grow">${esc(catName(c.id))}<small>${t('sharedCategories')}</small></span>${icon('next')}</button>`).join('')}</div>${!categories.length?empty():''}`}
function settingsPage(){
 const me=state.me,votes=state.calendar.votes;
 return `<h1 class="page-title">${t('settings')}</h1><div class="pair-card"><div class="members">${(state.members||[]).map(m=>`<span class="avatar">${esc(m.name?.slice(0,1)||'?')}</span>`).join('')}</div><div><strong>${t('pairTitle')}</strong><small>${(state.members||[]).length} / 2 ${t('seats')}</small></div></div><h3 class="section-label">${t('justYou')}</h3><section class="form-group settings-group"><div class="setting-row"><label for="setting-language">${t('language')}</label><select id="setting-language" name="setting-language">${[['ru','Русский'],['en','English']].map(([v,l])=>opt(v,l,me.language)).join('')}</select></div><div class="setting-row"><label for="setting-timezone">${t('timezone')}</label><input id="setting-timezone" name="setting-timezone" value="${esc(me.timezone)}"></div><div class="setting-row theme-row"><span>${t('theme')}</span><div class="segment">${['light','dark','system'].map(v=>button('theme',t(v),me.theme===v?'active':'',`data-theme="${v}" aria-pressed="${me.theme===v}"`)).join('')}</div></div><details class="default-settings"><summary>${t('defaults')}<small>${me.default_reminders.map(x=>x>=60?x/60+' h':x+' min').join(' · ')||'—'} ›</small></summary><div class="reminder-options"><p class="privacy">${t('defaultHelp')}</p>${reminderChoices(me.default_reminders,'default-reminder')}</div></details><label class="switch-row">${t('notify_at_start')}<input type="checkbox" role="switch" name="setting-notify_at_start" ${me.notify_at_start!==false?'checked':''}></label><label class="switch-row">${t('enabled')}<input type="checkbox" role="switch" name="setting-reminders_enabled" ${me.reminders_enabled?'checked':''}></label><div class="delivery-row"><span>${t('openBot')}</span><span class="delivery-status ${me.bot_can_message&&!me.delivery_error?'ok':''}">${me.bot_can_message&&!me.delivery_error?t('deliveryOk'):t('deliveryError')}</span></div>${!me.bot_can_message||me.delivery_error?`<div class="form-note"><p class="privacy">${t('botStart')}</p>${button('open-bot',t('openBot'),'full')}</div>`:''}</section>${!state.calendar.second_id?`<section class="form-group padded"><h3>${t('invite')}</h3><p class="privacy">${t('inviteHelp')}</p>${button('invite',t('invite'),'primary full')}${inviteUrl?`<p class="privacy">${esc(inviteUrl)}</p>${button('copy-invite',t('copy'),'full')}`:''}</section>`:''}<h3 class="section-label">${t('connectedCalendars')}</h3><section class="form-group"><div class="provider-row"><span class="provider-icon">G</span><span class="grow">Google<small>${t('notConnected')}</small></span><small>${t('notAvailable')}</small></div><div class="provider-row"><span class="provider-icon">i</span><span class="grow">Apple iCloud<small>${t('notConnected')}</small></span><small>${t('notAvailable')}</small></div></section><p class="privacy section-footnote">${t('integrationsInfo')}</p><h3 class="section-label">${t('sharedData')}</h3><section class="form-group settings-links">${button('trash',`${icon('trash')}<span class="grow">${t('trash')}</span>${icon('next')}`,'setting-link')}${button('backup',`${icon('archive')}<span class="grow">${t('backupExport')}</span><small>ICS · ZIP</small>${icon('next')}`,'setting-link')}</section><h3 class="section-label">${t('leaveOrDelete')}</h3><section class="form-group settings-links">${button('leave',t('leave'),'setting-link danger')}${votes.length?`<div class="notice">${votes.includes(me.id)?t('deletionPending'):t('deletionRequested')}</div>`:''}${!votes.includes(me.id)?button('approve-deletion',`<span>${t('deleteCalendar')}<small>${t('deleteHelp')}</small></span>`,'setting-link danger'):''}${votes.length?button('reject-deletion',t('reject'),'setting-link'):''}</section>`;
}
function trashPage(){return `${button('back',`‹ ${t('back')}`,'plain back')}<h2>${t('trash')}</h2><p class="muted">${t('trashHelp')}</p>${events.map(e=>`<div class="card"><h3>${esc(title(e))}</h3><p class="muted">${esc(e.start)} · ${esc(e.deleted_at.slice(0,10))}</p><div class="row">${button('restore-event',t('restore'),'primary',`data-id="${e.id}" data-revision="${e.revision}" data-occ="${esc(e.occurrence||'')}"`)}${button('permanent-event',t('deleteForever'),'danger',`data-id="${e.id}" data-revision="${e.revision}" data-occ="${esc(e.occurrence||'')}"`)}</div></div>`).join('')||empty()}`}
function backupPage(){
 let html=`${button('back',`‹ ${t('back')}`,'plain back')}<h2>${t('backup')}</h2><div class="card"><div class="row wrap">${button('download-zip',t('downloadZip'),'primary')}${button('download-ics',t('downloadIcs'))}</div></div><div class="card"><h3>${t('restoreZip')}</h3><input id="archive-file" type="file" accept=".zip,application/zip" aria-label="${t('chooseFile')}"><p></p>${button('preview-backup',t('preview'),'full')}</div>`;
 if(previewData){html+=`<div class="card"><h2>${t('archivePreview')}</h2><p class="muted">${t('archiveInfo')}</p><div class="scrollbox"><h3>${t('categories')}</h3>${previewData.categories.map(c=>`<label class="check-label"><input class="backup-category" type="checkbox" value="${c.id}">${esc(c.data.name)}</label>`).join('')}<h3>${t('differences')}</h3>${previewData.changes.map(e=>`<div>${Object.entries(e.fields).map(([k,v])=>`<div class="backup-field"><label class="check-label"><input type="checkbox" class="backup-field-choice" data-id="${e.id}" data-revision="${e.revision}" data-occ="${esc(e.occurrence||'')}" value="${k}">${t(k)}</label><small>${t('current')}</small><pre>${esc(JSON.stringify(v.current))}</pre><small>${t('archive')}</small><pre>${esc(JSON.stringify(v.archive))}</pre></div>`).join('')}</div>`).join('')||`<p class="muted">${t('noDifferences')}</p>`}<h3>${t('recurrenceExceptions')}</h3>${previewData.override_changes.map(e=>`<div class="backup-field"><p>${esc(e.occurrence)}</p>${Object.entries(e.fields).map(([k,v])=>`<label class="check-label"><input type="checkbox" class="backup-override" data-id="${e.id}" data-occ="${esc(e.occurrence)}" data-revision="${e.revision}" value="${esc(k)}">${t(k)}</label><small>${t('current')}</small><pre>${esc(JSON.stringify(v.current))}</pre><small>${t('archive')}</small><pre>${esc(JSON.stringify(v.archive))}</pre>`).join('')}</div>`).join('')}<h3>${t('mySettings')}</h3>${Object.entries(previewData.profile).map(([k,v])=>`<div class="backup-field"><label class="check-label"><input type="checkbox" class="backup-profile" value="${esc(k)}">${t(k)}</label><small>${t('current')}</small><pre>${esc(JSON.stringify(v.current))}</pre><small>${t('archive')}</small><pre>${esc(JSON.stringify(v.archive))}</pre></div>`).join('')}<h3>${t('missing')}</h3>${previewData.missing.map(e=>`<label class="check-label"><input type="checkbox" class="backup-missing" value="${e.id}">${esc(e.data.title)} · ${esc(e.data.start)}</label>`).join('')}</div>${button('apply-backup',t('applySelected'),'primary full')}</div>`}
 return html;
}
async function refresh(){state=await api('state');view=state.me.view;await loadData();render()}
async function loadData(){
 const version=++fetchVersion;
 if(!state.calendar?.active||state.calendar.state!=='active')return;
 if(page==='form'||page==='detail')return;
 categories=await api('categories');
 if(page==='trash'){events=await api('events?trash=true');return}
 if(tab!=='calendar'||page==='backup')return;
 const days=view==='month'?monthDays():view==='week'?weekDays():[selected];
 const params=new URLSearchParams({start:addDays(days[0],-1),end:addDays(days.at(-1),2),q:query,...filter});
 const result=await api('events?'+params);if(version===fetchVersion)events=result;
}
async function changeView(v){view=v;state.me.view=v;await api('settings','PATCH',{view:v});await loadData();render()}
async function openEvent(id,key){
 const master=await api('events/'+id+(key?'?occurrence='+encodeURIComponent(key):''));
 detailLanguage=state.me.language;
 currentEvent={...master,...(master.selected_instance||master.first_instance||{}),master};
 page='detail';render();
}
function captureForm(){
 const f=$('#event-form');if(!f)return;const d=new FormData(f);
 formEvent={...formEvent,title:d.get('title'),start:d.get('start'),end:d.get('end'),all_day:d.has('all_day'),owner:d.get('owner'),category_id:d.get('category_id')||null,timezone:d.get('timezone'),location:d.get('location'),description:d.get('description'),links:d.get('links').split('\n').map(x=>x.trim()).filter(Boolean),rrule:d.get('repeat')==='custom'?d.get('rrule').trim():(d.get('repeat')?'FREQ='+d.get('repeat'):''),fold:!d.get('fold')&&d.get('fold')!=='0'?undefined:Number(d.get('fold')),end_fold:!d.get('end_fold')&&d.get('end_fold')!=='0'?undefined:Number(d.get('end_fold')),
 reminders:{...formEvent.reminders,[state.me.id]:d.getAll('reminder').map(Number)},translations:{...formEvent.translations}};
 for(const lang of ['ru','en']){const title=d.get('title_'+lang),description=d.get('description_'+lang);const old=formEvent.translations?.[lang];if((title||description||old)&&(title!==(old?.title||'')||description!==(old?.description||'')))formEvent.translations[lang]={title,description,manual:true,stale:false}}
}
function confirmDialog(title,message=''){return new Promise(resolve=>{const el=document.createElement('div');el.className='modal-backdrop';el.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${message?`<p class="muted">${esc(message)}</p>`:''}<button class="danger" data-choice="yes">${t('approve')}</button><button data-choice="no">${t('cancel')}</button></div>`;document.body.append(el);const finish=answer=>{el.remove();resolve(answer)};el.addEventListener('click',e=>{const c=e.target.closest('[data-choice]');if(c)finish(c.dataset.choice==='yes')});$('[data-choice=no]',el).focus()})}
function chooseScope(){return new Promise(resolve=>{const el=document.createElement('div');el.className='modal-backdrop';el.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><h2>${t('occurrenceScope')}</h2>${[['one','one'],['following','following'],['all','series']].map(([v,k])=>`<button data-choice="${v}">${t(k)}</button>`).join('')}<button data-choice="cancel">${t('cancel')}</button></div>`;document.body.append(el);el.addEventListener('click',e=>{const c=e.target.closest('[data-choice]');if(c){el.remove();resolve(c.dataset.choice==='cancel'?null:c.dataset.choice)}});$('button',el).focus()})}
async function saveForm(){
 captureForm();const e=formEvent;
 const payload={};for(const k of ['title','description','start','end','all_day','timezone','owner','category_id','location','links','rrule','translations','fold','end_fold'])if(e[k]!==undefined)payload[k]=e[k];
 payload.reminders=e.reminders[state.me.id];
 try{
  let result;
  if(currentEvent?.rrule&&formScope!=='all'){
   result=await api('events/'+currentEvent.id+'/occurrence','POST',{occurrence:currentEvent.occurrence,revision:currentEvent.revision,scope:formScope,changes:payload});
  }else result=await api(currentEvent?'events/'+currentEvent.id:'events',currentEvent?'PATCH':'POST',{...payload,...(currentEvent?{revision:currentEvent.revision}:{})});
  toast(result.overlap_warning?.length?t('overlap'):t('saved'));
  const id=currentEvent?.id||result.id;page='main';await loadData();await openEvent(id,currentEvent?.occurrence||result.start);
 }catch(e){$('#form-error').textContent=e.message;$('#form-error').scrollIntoView({behavior:'smooth',block:'center'})}
}
async function fileBase64(selector){const file=$(selector)?.files?.[0];if(!file)throw new Error(t('chooseFile'));if(file.size>10*1024*1024)throw new Error('ZIP > 10 MB');return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file)})}
async function download(path,name){const blob=await api(path,'GET',null,true);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}
const actions={
 'choose-language':async el=>{state=await api('settings','PATCH',{language:el.dataset.lang});await loadData();render()},
 'translate-event':async()=>{await api('events/'+currentEvent.id+'/translate','POST',{});currentEvent.translation_status={state:'pending'};render();toast(t('translationQueued'))},
 'replace-translations':async()=>{if(await confirmDialog(t('replaceManual'),t('replaceManualHelp'))){await api('events/'+currentEvent.id+'/translate','POST',{overwrite_manual:true});currentEvent.translation_status={state:'pending'};render();toast(t('translationQueued'))}},
 'tab':async el=>{tab=el.dataset.tab;page='main';await loadData();render()},
 'view':el=>changeView(el.dataset.view),
 'search':async()=>{showSearch=!showSearch;if(!showSearch)query='';await loadData();render();$('#search')?.focus()},
 'clear-search':async()=>{query='';await loadData();render();$('#search')?.focus()},
 'reset-filters':async()=>{filter={owner:'',category:'',status:''};await loadData();render()},
 'close-app':()=>tg?.close(),
 'detail-language':el=>{detailLanguage=el.dataset.lang;render()},
 'set-status':async el=>{const e=currentEvent,value=el.dataset.status;if(e.rrule)await api('events/'+e.id+'/occurrence','POST',{occurrence:e.occurrence,revision:e.revision,scope:'one',changes:{status:value}});else await api('events/'+e.id,'PATCH',{revision:e.revision,status:value});await openEvent(e.id,e.occurrence)},
 'filters':()=>{showFilters=!showFilters;render()},
 'today':async()=>{selected=isoDay();await loadData();render()},
 'prev':()=>move(-1),'next':()=>move(1),
 'date':async el=>{selected=el.dataset.date;await changeView('day')},
 'week-date':el=>{selected=el.dataset.date;render()},
 'event':el=>openEvent(el.dataset.id,el.dataset.occ),
 'create':async()=>{await api('calendar','POST',{});await refresh()},
 'invite':async()=>{const result=await api('invite','POST',{});inviteUrl=result.url;render()},
 'copy-invite':async()=>{await navigator.clipboard.writeText(inviteUrl);toast(t('copied'))},
 'return':async()=>{await api('membership','POST',{returning:true});await refresh()},
 'leave':async()=>{if(await confirmDialog(t('leave'),t('leaveHelp'))){await api('membership','POST',{returning:false});await refresh()}},
 'new':()=>{currentEvent=null;formScope='all';formEvent={title:'',description:'',language:state.me.language,translations:{},start:selected+'T12:00',end:selected+'T13:00',all_day:false,timezone:tz(),owner:state.me.id,category_id:null,status:'planned',location:'',links:[],rrule:'',reminders:{[state.me.id]:state.me.default_reminders}};page='form';render()},
 'edit-event':async()=>{formScope=currentEvent.rrule?await chooseScope():'all';if(!formScope)return;formEvent=structuredClone(formScope==='all'?(currentEvent.master||currentEvent):currentEvent);page='form';render()},
 'back':async()=>{if(page==='form'&&currentEvent){page='detail';render();return}page='main';await loadData();render()},
 'delete-event':async()=>{const e=currentEvent,scope=e.rrule?await chooseScope():null;if(e.rrule&&!scope)return;if(!await confirmDialog(t('confirmDelete')))return;if(e.rrule)await api('events/'+e.id+'/occurrence','POST',{occurrence:e.occurrence,revision:e.revision,scope,delete:true});else await api('events/'+e.id,'DELETE',{revision:e.revision,confirmed:true});page='main';await loadData();render()},
 'trash':async()=>{page='trash';await loadData();render()},
 'restore-event':async el=>{await api('events/'+el.dataset.id+(el.dataset.occ?'/trash-occurrence':'/restore'),'POST',{revision:Number(el.dataset.revision),occurrence:el.dataset.occ});await loadData();render();toast(t('restored'))},
 'permanent-event':async el=>{if(await confirmDialog(t('confirmDelete'))){await api('events/'+el.dataset.id+(el.dataset.occ?'/trash-occurrence':''),el.dataset.occ?'POST':'DELETE',{revision:Number(el.dataset.revision),occurrence:el.dataset.occ,permanent:true,confirmed:true});await loadData();render()}},
 'backup':()=>{page='backup';previewData=null;archiveData=null;render()},
 'download-zip':()=>download('backup.zip','our-calendar.zip'),'download-ics':()=>download('calendar.ics','our-calendar.ics'),
 'preview-backup':async()=>{archiveData=await fileBase64('#archive-file');previewData=await api('backup/preview','POST',{archive:archiveData});render()},
 'apply-backup':async()=>{const byId={};$$('.backup-field-choice:checked').forEach(x=>{const e=byId[x.dataset.id]||{id:x.dataset.id,revision:Number(x.dataset.revision),fields:[]};e.fields.push(x.value);byId[e.id]=e});const ovs={};$$('.backup-override:checked').forEach(x=>{const key=x.dataset.id+'|'+x.dataset.occ;const value=ovs[key]||{id:x.dataset.id,occurrence:x.dataset.occ,revision:Number(x.dataset.revision),fields:[]};value.fields.push(x.value);ovs[key]=value});await api('backup/apply','POST',{archive:archiveData,preview_id:previewData.preview_id,override_selections:Object.values(ovs),profile_fields:$$('.backup-profile:checked').map(x=>x.value),previewed:true,selections:Object.values(byId),missing_ids:$$('.backup-missing:checked').map(x=>x.value),category_ids:$$('.backup-category:checked').map(x=>x.value)});previewData=null;await refresh();toast(t('restored'))},
 'approve-deletion':async()=>{if(await confirmDialog(t('deleteCalendar'),t('deleteHelp'))){await api('calendar/deletion','POST',{action:'approve'});await refresh()}},
 'reject-deletion':async()=>{await api('calendar/deletion','POST',{action:'reject'});await refresh()},
 'cancel-deletion':async()=>{await api('calendar/deletion','POST',{action:'cancel'});await refresh()},
 'open-bot':()=>{const url='https://t.me/'+cfg.bot_username+'?start=notifications';if(tg?.openTelegramLink)tg.openTelegramLink(url);else window.open(url,'_blank','noopener')},
 'request-restore':async()=>{const archive=await fileBase64('#deleted-archive');if(await confirmDialog(t('restoreDeleted'),t('fullRestoreInfo'))){await api('backup/restore-deleted','POST',{archive});await refresh()}},
 'approve-restore':async el=>{await api('backup/restore-deleted/'+el.dataset.id,'POST',{approve:true});await refresh()},
 'reject-restore':async el=>{await api('backup/restore-deleted/'+el.dataset.id,'POST',{approve:false});await refresh()},
 'theme':async el=>{state=await api('settings','PATCH',{theme:el.dataset.theme});render()},
 'new-category':()=>categoryDialog(),'edit-category':el=>categoryDialog(categories.find(x=>x.id===el.dataset.id))
};
async function move(n){if(view==='month'){const d=new Date(selected.slice(0,7)+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);selected=d.toISOString().slice(0,10)}else selected=addDays(selected,n*(view==='week'?7:1));await loadData();render()}
function categoryDialog(category){
 const el=document.createElement('div');el.className='modal-backdrop category-backdrop';const c=category||{name:'',color:'#9B77D1',translations:{}};
 el.innerHTML=`<form id="category-form" class="modal category-sheet" role="dialog" aria-modal="true"><div class="modal-header"><button type="button" id="close-category">${t('cancel')}</button><h2>${t(category?'edit':'newCategory')}</h2><button type="submit">${t('save')}</button></div><label>${t('name')}</label><div class="category-edit">${input('name',c.name,'text','required maxlength="100" aria-label="'+t('name')+'"')}${input('colorPicker',c.color,'color','aria-label="'+t('color')+'"')}</div><p></p>${field('color',input('color',c.color,'text','required pattern="#[0-9a-fA-F]{6}"'))}<div class="swatches">${['#9B77D1','#D47AAE','#D77777','#E0A34B','#D0BD55','#55A77B','#4DA5A8','#598DD4','#7778C9','#888888','#333333','#F3B6D4'].map(x=>`<button class="swatch ${x.toLowerCase()===c.color.toLowerCase()?'selected':''}" type="button" aria-pressed="${x.toLowerCase()===c.color.toLowerCase()}" data-color="${x}" data-bg="${x}" aria-label="${x}"></button>`).join('')}</div>${field('translations',input('ru',c.translations?.ru||'','text','placeholder="Русский"'))}${input('en',c.translations?.en||'','text','placeholder="English"')}<div class="color-preview"><div><span class="dot preview-dot" data-bg="${c.color}"></span>${t('light')}</div><div><span class="dot preview-dot" data-bg="${c.color}"></span>${t('dark')}</div></div><p class="privacy">${t('categoryDelete')}</p>${category?`<button type="button" id="remove-category" class="danger sheet-delete">${t('delete')}</button>`:''}</form>`;
 document.body.append(el);paint();$('input',el).focus();$('#close-category',el).onclick=()=>el.remove();
 const updateColor=value=>{$$('[data-color]',el).forEach(b=>{const active=b.dataset.color.toLowerCase()===value.toLowerCase();b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active))});$$('.preview-dot',el).forEach(d=>d.style.backgroundColor=value)};
 $$('[data-color]',el).forEach(b=>b.onclick=()=>{$('[name=color]',el).value=b.dataset.color;$('[name=colorPicker]',el).value=b.dataset.color;updateColor(b.dataset.color)});
 $('[name=colorPicker]',el).oninput=e=>{$('[name=color]',el).value=e.target.value;updateColor(e.target.value)};
 $('[name=color]',el).oninput=e=>{if(/^#[0-9a-fA-F]{6}$/.test(e.target.value)){$('[name=colorPicker]',el).value=e.target.value;updateColor(e.target.value)}};
 $('#category-form',el).onsubmit=async e=>{e.preventDefault();const d=new FormData(e.target);try{await api('categories'+(category?'/'+category.id:''),category?'PATCH':'POST',{name:d.get('name'),color:d.get('color'),translations:{ru:d.get('ru'),en:d.get('en')}});el.remove();await loadData();render()}catch(err){toast(err.message)}};
 if(category)$('#remove-category',el).onclick=async()=>{if(await confirmDialog(t('categoryDelete'))){await api('categories/'+category.id,'DELETE');el.remove();await loadData();render()}};
}
$('#app').addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el||busy)return;e.stopPropagation();const action=actions[el.dataset.action];if(!action)return;busy=true;try{await action(el)}catch(error){toast(error.message)}finally{busy=false}});
$('#app').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.day')){e.preventDefault();e.target.click()}});
$('#app').addEventListener('submit',async e=>{if(e.target.id==='event-form'){e.preventDefault();if(busy)return;busy=true;e.target.classList.add('busy');try{await saveForm()}finally{busy=false;$('#event-form')?.classList.remove('busy')}}});
$('#app').addEventListener('change',async e=>{const el=e.target;try{
 if(el.id==='demo-user'){await login(el.value);return}
 if(el.name==='all_day'){captureForm();if(formEvent.all_day){formEvent.start=formEvent.start.slice(0,10);formEvent.end=addDays(formEvent.start,1)}else{formEvent.start+='T12:00';formEvent.end=formEvent.start.slice(0,10)+'T13:00'}render();return}
 if(el.name==='repeat'){$('.custom-rule')?.classList.toggle('hidden',el.value!=='custom');return}
 if(el.name.startsWith('filter-')){filter[el.name.slice(7)]=el.value;await loadData();render();return}
 if(el.name==='event-status'){
  const value=el.value;if(currentEvent.rrule)await api('events/'+currentEvent.id+'/occurrence','POST',{occurrence:currentEvent.occurrence,revision:currentEvent.revision,scope:'one',changes:{status:value}});else await api('events/'+currentEvent.id,'PATCH',{revision:currentEvent.revision,status:value});
  const id=currentEvent.id,key=currentEvent.occurrence;page='main';await loadData();await openEvent(id,key);return;
 }
 if(el.name==='reminder'&&$$('[name=reminder]:checked').length>3){el.checked=false;toast(t('invalid_reminders'));return}
 if(el.name==='default-reminder'){const values=$$('[name=default-reminder]:checked').map(x=>Number(x.value));if(values.length>3){el.checked=false;toast(t('invalid_reminders'));return}await api('settings','PATCH',{default_reminders:values});state.me.default_reminders=values;return}
 if(el.name.startsWith('setting-')){const key=el.name.slice(8);state=await api('settings','PATCH',{[key]:el.type==='checkbox'?el.checked:el.value});render();return}
 }catch(error){toast(error.message);if(el.type==='checkbox')el.checked=!el.checked}});
let searchTimer;
$('#app').addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{try{const pos=$('#search')?.selectionStart;await loadData();render();$('#search')?.focus();$('#search')?.setSelectionRange(pos,pos)}catch(err){toast(err.message)}},250)}});
async function login(demoUser='1'){
 const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg.demo?{demo_user:demoUser}:{init_data:tg?.initData||''})});
 const result=await response.json();if(!response.ok)throw new Error(t(result.error));token=result.token;state=result.state;
 selected=isoDay();view=state.me.view;filter={owner:'',category:'',status:''};query='';page='main';tab='calendar';
 // A signed Telegram start_param is used only as an invite token, never as identity.
 const start=tg?.initDataUnsafe?.start_param;
 if(start?.startsWith('join_')&&!state.calendar){state=await api('join','POST',{token:start.slice(5)})}
 if(!state.calendar&&new URLSearchParams(location.search).get('join')&&cfg.demo)state=await api('join','POST',{token:new URLSearchParams(location.search).get('join')});
 // Device timezone is recorded once. Later manual changes remain authoritative.
 if(!state.me.timezone_initialized){
  const device=Intl.DateTimeFormat().resolvedOptions().timeZone;
  if(device)state=await api('settings','PATCH',{timezone:device});
  sessionStorage.setItem('timezone_initialized_'+state.me.id,'1');
 }
 await loadData();render();
}
async function boot(){
 try{tg?.ready();tg?.expand();cfg=await(await fetch('/api/config')).json();if(!cfg.demo&&!tg?.initData){$('#app').innerHTML=`<div class="splash"><div class="brand-mark">oc</div><h1>Our Calendar</h1><p>${t('telegramOnly')}</p></div>`;return}await login()}
 catch(error){$('#app').innerHTML=`<main class="shell"><div class="card"><h1>Our Calendar</h1><p class="error">${esc(error.message)}</p><button id="retry">${t('retry')}</button></div></main>`;$('#retry').onclick=boot}
}
matchMedia('(prefers-color-scheme:dark)').addEventListener('change',applyTheme);
window.addEventListener('focus',async()=>{if(token&&page==='main'&&!busy){try{await refresh()}catch{}}});
boot();

setInterval(async()=>{if(token&&!document.hidden&&page==='main'&&!busy){try{await refresh()}catch{}}},30000);

setInterval(async()=>{if(token&&!document.hidden&&page==='detail'&&currentEvent?.translation_status?.state==='pending'&&!busy){try{await openEvent(currentEvent.id,currentEvent.occurrence)}catch{}}},10000);
