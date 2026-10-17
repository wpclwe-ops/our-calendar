'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tg=window.Telegram?.WebApp;
// Touch/click focus stays quiet; keyboard navigation keeps a visible theme-coloured ring.
document.addEventListener('keydown',e=>{if(e.key==='Tab'||e.key.startsWith('Arrow'))document.documentElement.classList.add('keyboard-navigation')},true);
document.addEventListener('pointerdown',()=>document.documentElement.classList.remove('keyboard-navigation'),true);
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
Object.assign(words.ru,{day_layout:'Вид дня',dayList:'Список',dayTimeline:'По часам',completeEvent:'Отметить выполненным',undoComplete:'Вернуть в запланированные',completedCount:'выполнено',next:'Вперёд',close:'Закрыть',resetFilters:'Сбросить',results:'найдено',more:'ещё',yourTime:'Ваше время',noAllDay:'Нет событий на весь день',justYou:'Только для вас',sharedData:'Общие данные',leaveOrDelete:'Выход и удаление',pairTitle:'Вы и ваш партнёр',seats:'участников',sharedCategories:'Общие для вас двоих',notConnected:'Не подключено',notAvailable:'Пока недоступно',markDone:'Выполнено',cancelEvent:'Отменить событие',resumeEvent:'Запланировать',personalReminders:'Только ваши настройки',partnerReminders:'У партнёра свои напоминания',backupExport:'Резервные копии и экспорт',defaultIntervals:'Заранее',repeatedHour:'Переход на зимнее время',showTranslations:'Редактировать переводы',clearSearch:'Очистить поиск',connectedCalendars:'Ваши внешние календари'});
Object.assign(words.en,{day_layout:'Day layout',dayList:'List',dayTimeline:'Timeline',completeEvent:'Mark done',undoComplete:'Mark planned',completedCount:'completed',next:'Next',close:'Close',resetFilters:'Reset filters',results:'results',more:'more',yourTime:'Your time',noAllDay:'No all-day events',justYou:'Just for you',sharedData:'Shared data',leaveOrDelete:'Leave or delete',pairTitle:'You & your partner',seats:'seats',sharedCategories:'Shared by both of you',notConnected:'Not connected',notAvailable:'Not available yet',markDone:'Mark done',cancelEvent:'Cancel event',resumeEvent:'Mark planned',personalReminders:'Your settings only',partnerReminders:'Your partner has their own reminders',backupExport:'Backup & export',defaultIntervals:'In advance',repeatedHour:'When the clocks go back',showTranslations:'Edit translations',clearSearch:'Clear search',connectedCalendars:'Your connected calendars'});
Object.assign(words.ru,{calendar_deletion_expired:'30-дневный срок истёк. Календарь окончательно удаляется.',deleted_at:'Состояние в корзине',title_required:'Введите название.',count_or_until:'Выберите один способ окончания повторений.',repeatEvery:'Повторять каждые',repeatUnitDays:'дн.',repeatUnitWeeks:'нед.',repeatUnitMonths:'мес.',repeatUnitYears:'г.',weekdays:'Дни недели',monthPattern:'В месяце',byDate:'По числу',byWeekday:'По дню недели',monthDay:'Число месяца',ordinal:'Какой по счёту',firstOrdinal:'Первый',secondOrdinal:'Второй',thirdOrdinal:'Третий',fourthOrdinal:'Четвёртый',fifthOrdinal:'Пятый',lastOrdinal:'Последний',weekday:'День недели',repeatEnd:'Завершение',neverEnd:'Без окончания',onDate:'По дату включительно',afterCount:'После повторений',repeatCount:'Количество повторений',repeatUntil:'Последняя дата',preserveRule:'Сохранить существующее повторение',preserveRuleHelp:'У этой серии особый шаблон. Он сохранится. Чтобы заменить его, выберите другой вариант повторения.',shortMonthHelp:'В месяцах без выбранного числа или дня повторение пропускается.',choose_weekdays:'Выберите хотя бы один день недели.',invalid_recurrence:'Проверьте настройки повторения.',otherOccurrences:'Другие даты серии',occurrencesMonth:'Месяц',noOccurrences:'В этом месяце нет экземпляров серии.',retranslateCategory:'Перевести название заново',systemStatus:'Состояние сервиса',serviceReady:'Работает',serviceDelayed:'Требует внимания',backupReady:'Резервная копия сохранена',backupPending:'Ожидаем первую резервную копию',backupUnavailable:'Резервное копирование требует настройки',lastBackup:'Последняя копия',automaticBackups:'Автоматические резервные копии',refreshStatus:'Обновить состояние'});
Object.assign(words.en,{calendar_deletion_expired:'The 30-day period has ended. The calendar is being permanently deleted.',deleted_at:'Trash state',count_or_until:'Choose one recurrence end condition.',repeatEvery:'Repeat every',repeatUnitDays:'days',repeatUnitWeeks:'weeks',repeatUnitMonths:'months',repeatUnitYears:'years',weekdays:'Weekdays',monthPattern:'Monthly pattern',byDate:'By date',byWeekday:'By weekday',monthDay:'Day of month',ordinal:'Which occurrence',firstOrdinal:'First',secondOrdinal:'Second',thirdOrdinal:'Third',fourthOrdinal:'Fourth',fifthOrdinal:'Fifth',lastOrdinal:'Last',weekday:'Weekday',repeatEnd:'Ends',neverEnd:'Never',onDate:'On date (inclusive)',afterCount:'After occurrences',repeatCount:'Number of occurrences',repeatUntil:'Last date',preserveRule:'Keep existing recurrence',preserveRuleHelp:'This series has a special pattern. It will be kept. Select another recurrence to replace it.',shortMonthHelp:'Months without this date or weekday are skipped.',choose_weekdays:'Select at least one weekday.',invalid_recurrence:'Check the recurrence settings.',otherOccurrences:'Other dates in this series',occurrencesMonth:'Month',noOccurrences:'No occurrences this month.',retranslateCategory:'Translate name again',systemStatus:'Service status',serviceReady:'Working',serviceDelayed:'Needs attention',backupReady:'Backup saved',backupPending:'Waiting for first backup',backupUnavailable:'Backups need configuration',lastBackup:'Last backup',automaticBackups:'Automatic backups',refreshStatus:'Refresh status'});
Object.assign(words.ru,{defaultDayLayout:'Вид дня по умолчанию',month_layout:'Вид месяца',monthPaged:'Постраничный',monthScroll:'Прокручиваемый',default_duration:'Длительность события',duration30:'30 минут',duration60:'1 час',duration120:'2 часа',durationOther:'Другая',durationMinutes:'Длительность в минутах',now:'Сейчас',eventUnavailable:'Событие удалено или недоступно.',dragHint:'Удерживайте и перетащите, чтобы изменить время',invalid_settings:'Проверьте значение настройки.'});
Object.assign(words.en,{defaultDayLayout:'Default day view',month_layout:'Month view',monthPaged:'Paged',monthScroll:'Scrolling',default_duration:'Default event duration',duration30:'30 minutes',duration60:'1 hour',duration120:'2 hours',durationOther:'Custom',durationMinutes:'Duration in minutes',now:'Now',eventUnavailable:'This event was deleted or is unavailable.',dragHint:'Hold and drag to change the time',invalid_settings:'Check this setting.'});
Object.assign(words.ru,{touchBar:'Touch Bar',touch_bar:'Touch Bar',touchBarHelp:'Выберите кнопки нижней панели и измените их порядок. Настройки всегда доступны последними.',moveUp:'Выше',moveDown:'Ниже',alwaysVisible:'Всегда на панели'});
Object.assign(words.en,{touchBar:'Touch Bar',touch_bar:'Touch Bar',touchBarHelp:'Choose and reorder the bottom navigation buttons. Settings always stays last.',moveUp:'Move up',moveDown:'Move down',alwaysVisible:'Always visible'});
Object.assign(words.ru,{changeStatus:'Изменить статус события',eventReminders:'Мои напоминания · это событие',eventReminderHelp:'Эти интервалы действуют только для данного события и только для вас. Настройки напоминаний партнёра независимы.',backToSettings:'К настройкам'});
Object.assign(words.en,{changeStatus:'Change event status',eventReminders:'My reminders · this event',eventReminderHelp:'These intervals apply only to this event and to you. Your partner manages their own reminders.',backToSettings:'Back to settings'});
const icons={calendar:'<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',categories:'<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4"/>',settings:'<path d="M10.3 2.5h3.4l.5 2.1 1.7.7 1.8-1.1 2.4 2.4-1.1 1.8.7 1.7 2.1.5v3.4l-2.1.5-.7 1.7 1.1 1.8-2.4 2.4-1.8-1.1-1.7.7-.5 2.1h-3.4l-.5-2.1-1.7-.7-1.8 1.1-2.4-2.4 1.1-1.8-.7-1.7-2.1-.5v-3.4l2.1-.5.7-1.7-1.1-1.8 2.4-2.4 1.8 1.1 1.7-.7z"/><circle cx="12" cy="12" r="3"/>',search:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',filters:'<path d="M4 6h16M7 12h10M10 18h4"/>',prev:'<path d="M15 5l-7 7 7 7"/>',next:'<path d="M9 5l7 7-7 7"/>',plus:'<path d="M12 5v14M5 12h14"/>',repeat:'<path d="M4 8h15l-3-3M20 16H5l3 3M20 8v3M4 16v-3"/>',check:'<path d="M5 12l4 4L19 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z"/><circle cx="12" cy="10" r="2"/>',trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',archive:'<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M10 12h4"/>',close:'<path d="M6 6l12 12M6 18L18 6"/>'};
const icon=name=>`<svg class="svg-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.calendar}</svg>`;
Object.assign(words.ru,{applyFilters:'Применить'});Object.assign(words.en,{applyFilters:'Apply'});
Object.assign(icons,{list:'<circle cx="5" cy="6" r="1.5"/><path d="M10 6h10M10 12h10M10 18h10"/><circle cx="5" cy="12" r="1.5"/><circle cx="5" cy="18" r="1.5"/>',scroll:'<rect x="5" y="7" width="14" height="10" rx="2"/><path d="M5 3h14M5 21h14"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>'});
const radioSegment=(name,items,value)=>`<div class="segment radio-segment" role="group" aria-label="${esc(t(({category_id:'category','filter-category':'category','filter-owner':'owner','filter-status':'status','event-status':'status'}[name]||name)))}">${items.map(([v,l])=>`<label><input type="radio" name="${name}" value="${esc(v)}" ${v===value?'checked':''}><span>${esc(l)}</span></label>`).join('')}</div>`;
let state=null,cfg={},events=[],categories=[],tab='calendar',page='main',selected='',view='day',query='',showSearch=false,showFilters=false;
let filter={owner:'',category:'',status:''},currentEvent=null,formEvent=null,formScope='all',archiveData=null,previewData=null,inviteUrl='';
let token='',busy=false,fetchVersion=0,detailLanguage='',systemStatus=null;
const navigationCache=new Map();
let monthWindow=[],monthLoading=false,endManuallySet=false,monthResize=null;

const t=k=>(words[state?.me?.language||'ru'][k]||words.en[k]||k);
const locale=()=>state?.me?.language==='en'?'en-GB':'ru-RU';
const tz=()=>state?.me?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
const zoned=(value,options={})=>new Intl.DateTimeFormat(locale(),{timeZone:tz(),...options}).format(new Date(value));
const isoDay=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:tz(),year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
const addDays=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const dateLabel=(s,options={})=>new Intl.DateTimeFormat(locale(),{timeZone:'UTC',...options}).format(new Date(s+'T12:00:00Z'));
const monthDays=(day=selected)=>{const d=new Date(day.slice(0,7)+'-01T12:00:00Z');const offset=(d.getUTCDay()+6)%7;const count=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();const start=addDays(d.toISOString().slice(0,10),-offset);return Array.from({length:Math.ceil((offset+count)/7)*7},(_,i)=>addDays(start,i))};
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
const select=(name,items,value)=>`<select name="${name}" aria-label="${esc(t(({category_id:'category','filter-category':'category','filter-owner':'owner','filter-status':'status','event-status':'status'}[name]||name)))}">${items.map(([v,l])=>opt(v,l,value)).join('')}</select>`;
const empty=()=>`<div class="empty"><div class="empty-symbol">◌</div><h3>${t('empty')}</h3><p>${t('emptyHelp')}</p></div>`;
const time=e=>e.all_day?t('allDay'):zoned(e.start_utc||e.start,{hour:'2-digit',minute:'2-digit'});
const reminderLabel=n=>n>=60?`${n/60} ${state.me.language==='ru'?'ч':'h'}`:`${n} ${state.me.language==='ru'?'мин':'min'}`;
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
function paint(root=document){
 const dark=document.body.classList.contains('dark');
 $$('[data-bg]',root).forEach(el=>{el.style.backgroundColor=el.dataset.bg;if(el.classList.contains('event-bar')||el.classList.contains('time-event')||el.classList.contains('category-chip')){el.style.backgroundColor=`color-mix(in srgb, ${el.dataset.bg} ${dark?'22':'16'}%, var(--card))`;el.style.color=`color-mix(in srgb, ${el.dataset.bg} ${dark?'45':'65'}%, ${dark?'white':'black'})`}});
 $$('[data-fg]',root).forEach(el=>el.style.color=el.dataset.fg);
 $$('[data-top]',root).forEach(el=>{el.style.top=el.dataset.top+'px';el.style.height=el.dataset.height+'px';el.style.left=`calc(54px + (100% - 54px) * ${el.dataset.lane} / ${el.dataset.lanes})`;el.style.width=`calc((100% - 54px) / ${el.dataset.lanes})`});$$('.hour',root).forEach(el=>el.style.top=el.dataset.hour*70+'px');
 $$('.days',root).forEach(days=>days.style.gridTemplateRows=`repeat(${days.children.length/7},minmax(0,1fr))`);
}
function header(){
 const sub=page!=='main',form=page==='form',active=state.calendar?.active;
 const left=sub?button('back',`${icon('prev')}${t(form?'cancel':'back')}`,'header-back'):tg?.initData?button('close-app',t('close'),'header-back'):'';
 const right=form?`<button type="submit" form="event-form" class="header-save">${t('save')}</button>`:page==='detail'?button('edit-event',t('edit'),'header-save'):active?button('tab',icon('settings'),'icon','data-tab="settings" aria-label="'+t('settings')+'"'):'';
 return `<header class="header ${tg?.initData&&!sub?'telegram-native':''}"><div class="header-side">${left}</div><div class="header-title">${form?t(currentEvent?'editEvent':'newEvent'):'Our Calendar'}${!form?'<small>mini app</small>':''}</div><div class="header-side right">${right}</div></header>`;
}
function touchBarItems(){return state.me.touch_bar||['day','month','settings']}
function navigation(){return `<nav class="bottom-nav" aria-label="${esc(t('calendar'))}">${touchBarItems().map(id=>{const mode=['day','week','month'].includes(id),active=mode?tab==='calendar'&&view===id:tab===id;return `<button type="button" data-action="${mode?'nav-view':'tab'}" ${mode?`data-view="${id}"`:`data-tab="${id}"`} class="${active?'active':''}" ${active?'aria-current="page"':''}><span class="touchbar-content">${icon(id==='day'?'sun':id==='week'||id==='month'?'calendar':id)}<span>${t(id)}</span></span></button>`}).join('')}</nav>`}
function touchBarPage(){
 const items=touchBarItems(),available=['day','week','month','categories'].filter(id=>!items.includes(id));
 return `<h1>${t('touchBar')}</h1><p class="privacy">${t('touchBarHelp')}</p><section class="form-group touchbar-editor">${[...items,...available].map(id=>{const index=items.indexOf(id),fixed=id==='settings',checked=index>=0;return `<div class="touchbar-row" data-item="${id}"><label><input type="checkbox" name="touchbar-item" value="${id}" ${checked?'checked':''} ${fixed?'disabled':''}>${t(id)}${fixed?`<small>${t('alwaysVisible')}</small>`:''}</label>${checked&&!fixed?`<button type="button" class="touchbar-handle icon" data-drag="${id}" aria-label="${esc(t(id))}" title="${esc(t('touchBarHelp'))}">☰</button>${button('touchbar-move',icon('prev'),'icon',`data-item="${id}" data-direction="-1" aria-label="${t('moveUp')}" ${index===0?'disabled':''}`)}${button('touchbar-move',icon('next'),'icon',`data-item="${id}" data-direction="1" aria-label="${t('moveDown')}" ${index===items.length-2?'disabled':''}`)}`:''}</div>`}).join('')}</section>`;
}
async function saveTouchBar(items){state=await api('settings','PATCH',{touch_bar:items});render()}
function mountTouchBar(){
 $$('.touchbar-handle').forEach(handle=>handle.addEventListener('pointerdown',e=>{
  if(e.button!==0||busy)return;e.preventDefault();handle.setPointerCapture(e.pointerId);
  const row=handle.closest('.touchbar-row'),editor=row.parentElement;let moved=false;
  row.classList.add('reordering');
  const move=event=>{const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.touchbar-row');if(!target||target===row||target.parentElement!==editor||target.dataset.item==='settings'||!touchBarItems().includes(target.dataset.item))return;const after=event.clientY>target.getBoundingClientRect().top+target.offsetHeight/2;editor.insertBefore(row,after?target.nextSibling:target);moved=true};
  const finish=async event=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);row.classList.remove('reordering');if(event.type==='pointercancel'){render();return}if(!moved)return;busy=true;try{await saveTouchBar($$('.touchbar-row',editor).map(x=>x.dataset.item).filter(id=>touchBarItems().includes(id)))}catch(error){render();toast(error.message)}finally{busy=false}};
  document.addEventListener('pointermove',move);document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
 }));
}
function demo(){return cfg.demo?`<div class="demo">${t('demo')}<select id="demo-user" aria-label="Demo account">${['1','2','3'].map(x=>opt(x,'User '+x,state?.me.id)).join('')}</select></div>`:''}
function render(){
 const oldNavigation=$('.calendar-motion-page:not(.motion-preview) .navigation-content'),navigationPosition=oldNavigation?{tab:document.body.dataset.tab,top:oldNavigation.scrollTop}:null;
 monthResize?.disconnect();monthResize=null;
 const oldAgenda=$('.month-with-agenda,.day-checklist'),agendaPosition=oldAgenda?{day:oldAgenda.dataset.date,top:oldAgenda.scrollTop}:null;
 const oldTimeline=$('.timeline'),timelinePosition=oldTimeline?{day:oldTimeline.dataset.date,top:oldTimeline.scrollTop}:null;
 const oldMonths=$('.month-scroll'),monthPosition=oldMonths&&oldMonths.dataset.focus===selected?monthAnchor(oldMonths):null;
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
 else if(page==='touchbar')html=touchBarPage();
 else if(tab==='calendar')html=calendarPage();
 else if(tab==='categories')html=categoriesPage();
 else html=settingsPage();
 const active=state.calendar?.active;
 document.body.dataset.page=page;document.body.dataset.tab=tab;document.body.classList.toggle('calendar-screen',Boolean(active&&tab==='calendar'&&page==='main'&&!showSearch));
 const mainNavigation=active&&page==='main'&&!showSearch;
 const content=mainNavigation?`<div class="calendar-motion-viewport"><div class="calendar-motion-page" data-view="${activeNavigation()}">${tab==='calendar'?html:`<div class="navigation-content">${html}</div>`}</div></div>`:html;
 $('#app').innerHTML=demo()+`<main class="shell ${page==='main'?'main-screen':'sub-screen'} ${mainNavigation?(tab==='calendar'?'calendar-shell':'navigation-shell'):''}">${header()}${content}</main>`+(active&&page==='main'?navigation():'')+(active&&tab==='calendar'&&page==='main'&&!showSearch?`<div class="calendar-actions">${button('today',t('today'),'today-btn')}${button('new',icon('plus'),'fab','aria-label="'+t('newEvent')+'"')}</div>`:'');
 paint();
 const agenda=$('.month-with-agenda,.day-checklist');if(agendaPosition&&agenda?.dataset.date===agendaPosition.day)agenda.scrollTop=agendaPosition.top;
 if(page==='main'&&navigationPosition?.tab===tab){const content=$('.navigation-content');if(content)content.scrollTop=navigationPosition.top}
 if(page==='touchbar')mountTouchBar();
 if(page==='main'&&tab==='calendar'&&!query){positionTimeline(document,timelinePosition);mountMonthScroll(monthPosition)}
}
function filterControls(){return `<div class="filters">${select('filter-owner',[['',t('owner')+': '+t('all')],[state.me.id,t('mine')],[(state.members||[]).find(x=>x.id!==state.me.id)?.id||'partner',t('partner')],['both',t('both')]],filter.owner)}${select('filter-category',[['',t('categories')],['none',t('noCategory')],...categories.map(c=>[c.id,catName(c.id)])],filter.category)}${select('filter-status',[['',t('status')+': '+t('all')],...['planned','done','cancelled'].map(x=>[x,t(x)])],filter.status)}</div>`}
function filterDialog(){
 if($('.filter-backdrop'))return;
 const el=document.createElement('div');el.className='modal-backdrop filter-backdrop';
 el.innerHTML=`<form class="modal filter-sheet" role="dialog" aria-modal="true" aria-labelledby="filter-title"><div class="modal-header"><h2 id="filter-title">${t('filters')}</h2><button type="button" data-close aria-label="${t('close')}">${icon('close')}</button></div>${filterControls()}<div class="filter-actions"><button type="button" data-reset>${t('resetFilters')}</button><button type="submit" class="primary">${t('applyFilters')}</button></div></form>`;
 $$('.filters select',el).forEach(control=>{const label=document.createElement('label');label.textContent=t({'filter-owner':'owner','filter-category':'categories','filter-status':'status'}[control.name]);control.before(label);label.append(control)});
 const close=()=>{el.remove();showFilters=false;$('[data-action=filters]')?.focus()};
 el.addEventListener('click',e=>{if(e.target===el||e.target.closest('[data-close]'))close();if(e.target.closest('[data-reset]'))$$('select',el).forEach(s=>s.value='')});
 el.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='Tab'){const controls=$$('button,select',el),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
 $('form',el).addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;const previous={...filter};try{const data=new FormData(e.target);filter={owner:data.get('filter-owner'),category:data.get('filter-category'),status:data.get('filter-status')};await loadData();render();close()}catch(error){filter=previous;toast(error.message)}finally{busy=false}});
 document.body.append(el);showFilters=true;$('[data-close]',el).focus();
}
function calendarPage(){
 const week=view==='week'?CalendarNavigation.weekHeading(selected,state.me.language):null;
 const heading=week?week.title:view==='day'?(selected===isoDay()?t('today'):dateLabel(selected,{day:'numeric',month:'long'})):dateLabel(selected,{month:'long'});
 let html='';
 if(showSearch){
  html=`<section class="search-page"><div class="search-box">${icon('search')}<input id="search" type="search" value="${esc(query)}" placeholder="${t('search')}" aria-label="${t('search')}">${button(query?'clear-search':'search',icon('close'),'icon',`aria-label="${t(query?'clearSearch':'close')}"`)}</div>${filterControls()}<div class="search-summary"><span>${events.length} ${t('results')}</span>${button('reset-filters',t('resetFilters'),'text-button')}</div>`;
  const groups=new Map();
  for(const e of events){const month=eventDay(e).slice(0,7);if(!groups.has(month))groups.set(month,[]);groups.get(month).push(e)}
  for(const [month,entries] of groups)html+=`<h3 class="section-label">${esc(dateLabel(month+'-01',{month:'long',year:'numeric'}))}</h3><div class="search-event-group">${eventList(entries)}</div>`;
  return html+(events.length?'':empty())+'</section>';
 }
 const subtitle=week?`<small class="week-range">${esc(week.range)}</small>`:view==='day'?`<small class="day-weekday">${esc(dateLabel(selected,{weekday:'long'}))}</small><small>${esc(dateLabel(selected,{day:'numeric',month:'long'}))}</small>`:`<small class="calendar-year">${esc(dateLabel(selected,{year:'numeric'}))}</small>`;
 const layoutButton=view==='day'?button('day-layout',icon('list'),`icon layout-toggle ${state.me.day_layout==='list'?'selected':''}`,`data-layout="${state.me.day_layout==='list'?'timeline':'list'}" aria-label="${t('day_layout')}: ${t(state.me.day_layout==='list'?'dayList':'dayTimeline')}" aria-pressed="${state.me.day_layout==='list'}"`):view==='month'?button('month-layout',icon(state.me.month_layout==='scroll'?'scroll':'calendar'),'icon layout-toggle',`aria-label="${t('month_layout')}: ${t(state.me.month_layout==='scroll'?'monthScroll':'monthPaged')}"`):'<span aria-hidden="true"></span>';
 html=`<section class="calendar-controls"><div class="calendar-heading"><div class="grow"><h1 class="month-title${week?' week-title':''}">${esc(heading)}</h1>${subtitle}</div><div class="calendar-tools">${button('search',icon('search'),'icon',`aria-label="${t('search')}"`)}${button('filters',icon('filters'),`icon ${Object.values(filter).some(Boolean)?'selected':''}`,`aria-label="${t('filters')}" aria-haspopup="dialog"`)}${layoutButton}${button('prev',icon('prev'),'icon period-prev',`aria-label="${t('back')}"`)}${button('next',icon('next'),'icon period-next',`aria-label="${t('next')}"`)}</div></div></section>`;
 if(view==='month'){
 if(state.me.month_layout==='scroll'){
  ensureMonthWindow();
  html+=`<div class="scroll-month-weekdays weekdays">${weekdayLabels()}</div><div class="month-scroll" data-selected="${selected}" data-focus="${selected}">${scrollingWeeks()}</div>`;
 }else html+=`<section class="month-with-agenda" data-date="${selected}">${monthGrid(selected)}<div class="agenda month-agenda" data-date="${selected}"><div class="agenda-heading"><h2>${esc(dateLabel(selected,{weekday:'long',day:'numeric',month:'long'}))}</h2></div>${taskList(events.filter(e=>onDay(e,selected)))}</div></section>`;
 }else if(view==='week'){
 const daily=events.filter(e=>onDay(e,selected));
 html+=`<div class="week-strip">${weekDays().map(d=>button('week-date',`${esc(dateLabel(d,{weekday:'short'}))}<span class="date-number">${Number(d.slice(-2))}</span>${weekIndicator(d)}`,`week-date ${d===selected?'selected':''} ${d===isoDay()?'today':''}`,`data-date="${d}" aria-pressed="${d===selected}"`)).join('')}</div><div class="agenda" data-date="${selected}"><div class="agenda-heading"><h2>${esc(dateLabel(selected,{weekday:'long',day:'numeric',month:'long'}))}</h2><small>${daily.length}</small></div>${taskList(daily)}</div>`;
 }else{
 html+=state.me.day_layout==='list'?dayChecklist():timeline();
 }
 return html;
}
function taskList(items){
 const daily=[...items].sort((a,b)=>Number(b.all_day)-Number(a.all_day)||(a.start_utc||a.start).localeCompare(b.start_utc||b.start)||title(a).localeCompare(title(b)));
 if(!daily.length)return empty();
 return `<div class="day-tasks">${daily.map(e=>{const attrs=`data-id="${esc(e.id)}" data-occ="${esc(e.occurrence||'')}"`;return `<div class="day-task ${e.status==='done'?'completed':''} ${e.status==='cancelled'?'cancelled-task':''}"><span class="day-task-stripe" data-bg="${esc(color(e.category_id))}"></span><button type="button" class="day-task-card" data-action="event" ${attrs}><span class="day-task-title">${esc(title(e))}</span><span class="day-task-time">${icon('clock')}${esc(time(e))}${!e.all_day?' – '+esc(zoned(e.end_utc,{hour:'2-digit',minute:'2-digit'})):''}${e.rrule?' · ↻':''}</span><span class="day-task-meta"><span data-fg="${esc(color(e.category_id))}">${esc(catName(e.category_id))}</span> · ${ownership(e.owner)}${e.status==='cancelled'?' · '+t('cancelled'):''}</span></button><span class="task-actions">${button('toggle-day-done',e.status==='done'?icon('check'):'','task-check',`${attrs} aria-label="${esc(t(e.status==='done'?'undoComplete':'completeEvent')+': '+title(e))}" aria-pressed="${e.status==='done'}"`)}${button('delete-day-event',icon('trash'),'task-delete',`${attrs} aria-label="${esc(t('delete')+': '+title(e))}"`)}</span></div>`}).join('')}</div>`;
}
function dayChecklist(){return `<section class="day-checklist" data-date="${selected}" aria-label="${t('dayList')}">${taskList(events.filter(e=>onDay(e,selected)))}</section>`}
function listedEvent(el){const e=events.find(e=>e.id===el.dataset.id&&(e.occurrence||'')===(el.dataset.occ||''));if(!e)throw new Error(t('revision_conflict'));return e}
async function changeEventStatus(e,value){
 if(e.rrule)await api('events/'+e.id+'/occurrence','POST',{occurrence:e.occurrence,revision:e.revision,scope:'one',changes:{status:value}});
 else await api('events/'+e.id,'PATCH',{revision:e.revision,status:value});
}
async function deleteCalendarEvent(e){
 const scope=e.rrule?await chooseScope():null;if(e.rrule&&!scope)return;if(!await confirmDialog(t('confirmDelete')))return;
 if(e.rrule)await api('events/'+e.id+'/occurrence','POST',{occurrence:e.occurrence,revision:e.revision,scope,delete:true});
 else await api('events/'+e.id,'DELETE',{revision:e.revision,confirmed:true});
 page='main';await loadData();render();
}
function timeline(){
 const daily=events.filter(e=>onDay(e,selected)),all=daily.filter(e=>e.all_day),timed=daily.filter(e=>!e.all_day);
 let html=`<div class="all-day-row"><span>${t('allDay')}</span><div>${all.length?eventList(all):`<small>${t('noAllDay')}</small>`}</div></div>`;
 const minute=iso=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:tz(),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));return Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value)};
 const items=timed.map(e=>({event:e,start:eventDay(e)<selected?0:minute(e.start_utc),end:isoDay(new Date(e.end_utc))>selected?1440:minute(e.end_utc)})).sort((a,b)=>a.start-b.start||b.end-a.end);
 const groups=[];for(const item of items){let group=groups.at(-1);if(!group||item.start>=group.end){group={end:item.end,items:[],lanes:[]};groups.push(group)}group.end=Math.max(group.end,item.end);let lane=group.lanes.findIndex(end=>end<=item.start);if(lane<0)lane=group.lanes.length;group.lanes[lane]=item.end;item.lane=lane;group.items.push(item)}
 html+=`<div class="timeline" data-date="${selected}"><div class="timeline-inner">${Array.from({length:24},(_,i)=>`<div class="hour" data-hour="${i}"><span>${String(i).padStart(2,'0')}:00</span></div>`).join('')}${groups.flatMap(g=>g.items.map(x=>{const e=x.event;return `<button class="time-event ${(x.end-x.start)<60?'short-event':''} ${e.status!=='planned'?'faded':''}" data-bg="${color(e.category_id)}" data-top="${x.start/60*70}" data-height="${(x.end-x.start)/60*70}" data-lane="${x.lane}" data-lanes="${g.lanes.length}" data-action="event" data-id="${e.id}" data-occ="${esc(e.occurrence)}" title="${t('dragHint')}" aria-label="${esc([title(e),ownership(e.owner),time(e),zoned(e.end_utc,{hour:'2-digit',minute:'2-digit'})].join(' · '))}"><span class="time-event-heading"><span class="time-event-title">${e.status==='done'?'✓ ':e.status==='cancelled'?'⊘ ':''}${esc(title(e))}</span><small class="time-owner">${esc(ownership(e.owner))}</small></span><small class="time-range">${esc(time(e))}–${esc(zoned(e.end_utc,{hour:'2-digit',minute:'2-digit'}))}</small></button>`})).join('')}${selected===isoDay()?'<div class="now-line" role="img"></div>':''}</div></div>`;
 return html;
}
function newEvent(day=selected,minutes){
 currentEvent=null;formScope='all';endManuallySet=false;
 formEvent={title:'',description:'',language:state.me.language,translations:{},...CalendarTime.defaults(day,tz(),state.me.default_duration||60,new Date(),minutes),all_day:false,timezone:tz(),owner:state.me.id,category_id:null,status:'planned',location:'',links:[],rrule:'',advanced:true,reminders:{[state.me.id]:[...state.me.default_reminders]}};
 page='form';render();
}
function weekIndicator(day){
 const first=events.filter(e=>onDay(e,day)&&e.status==='planned').sort((a,b)=>Number(b.all_day)-Number(a.all_day)||(a.start_utc||a.start).localeCompare(b.start_utc||b.start)||a.id.localeCompare(b.id))[0];
 return `<span class="week-marker-slot">${first?`<span class="week-marker" data-bg="${color(first.category_id)}" role="img" aria-label="${esc(t('planned')+': '+catName(first.category_id))}"></span>`:''}</span>`;
}
function weekdayLabels(){return Array.from({length:7},(_,i)=>`<div>${esc(dateLabel(addDays('2026-10-12',i),{weekday:'short'}))}</div>`).join('')}
function monthCell(d,day,scroll=false){
 const entries=events.filter(e=>onDay(e,d)).sort((a,b)=>Number(b.all_day)-Number(a.all_day)||(a.start_utc||a.start).localeCompare(b.start_utc||b.start));
 const marks=scroll?entries.slice(0,5).map(e=>{
  const first=eventDay(e)===d,last=e.all_day?addDays(e.end,-1)===d:isoDay(new Date(Date.parse(e.end_utc)-1))===d;
  return `<button class="event-bar ${e.status!=='planned'?'faded':''} ${e.status==='cancelled'?'struck':''} ${!first?'continues-left':''} ${!last?'continues-right':''}" data-bg="${color(e.category_id)}" data-action="event" data-id="${esc(e.id)}" data-occ="${esc(e.occurrence||'')}" aria-label="${esc(title(e)+' · '+time(e))}"><span class="month-event-title">${e.status==='done'?'✓ ':''}${esc(title(e))}</span><span class="month-event-time">${esc(time(e))}</span></button>`;
 }).join('')+(entries.length>5?button('month-day-list','+'+(entries.length-5),'more',`data-date="${d}" aria-label="${esc(dateLabel(d,{day:'numeric',month:'long'}))}: ${entries.length} ${t('more')}"`):''):`<span class="month-markers">${entries.slice(0,3).map(e=>`<span data-bg="${color(e.category_id)}"></span>`).join('')}</span>`;
 return `<div class="day ${!scroll&&d.slice(0,7)!==day.slice(0,7)?'outside':''} ${d===isoDay()?'today':''} ${d===selected?'chosen-date':''}" data-action="date" data-date="${d}" role="button" tabindex="0" aria-label="${esc(dateLabel(d,{day:'numeric',month:'long'}))}"><div class="date-caption">${scroll&&d.endsWith('-01')?`<small class="month-caption">${esc(dateLabel(d,{month:'short'}))}</small>`:''}<div class="day-number">${Number(d.slice(-2))}</div></div>${marks}</div>`;
}
function monthGrid(day){return `<div class="month"><div class="weekdays">${weekdayLabels()}</div><div class="days">${monthDays(day).map(d=>monthCell(d,day)).join('')}</div></div>`}
function scrollingWeeks(){
 const first=monthDays(monthWindow[0])[0],last=monthDays(monthWindow.at(-1)).at(-1),rows=[];
 for(let day=first;day<=last;day=addDays(day,7))rows.push(`<div class="scroll-week" data-week="${day}">${Array.from({length:7},(_,i)=>monthCell(addDays(day,i),selected,true)).join('')}</div>`);
 return rows.join('');
}
function ensureMonthWindow(){
 const month=selected.slice(0,7)+'-01';
 if(!monthWindow.includes(month))monthWindow=[-1,0,1].map(n=>CalendarNavigation.shift(month,'month',n));
}
function calendarRange(){
 if(view==='month'&&state.me.month_layout==='scroll'){
  ensureMonthWindow();return [monthDays(monthWindow[0])[0],monthDays(monthWindow.at(-1)).at(-1)];
 }
 return view==='month'?monthDays():view==='week'?weekDays():[selected];
}
function monthAnchor(el){
 const rows=$$('.scroll-week',el),item=rows.find(x=>x.offsetTop+x.offsetHeight>el.scrollTop+1)||rows.at(-1);
 return item?{week:item.dataset.week,offset:el.scrollTop-item.offsetTop}:null;
}
function positionMonths(el,anchor){
 el.style.setProperty('--week-height',el.clientHeight/2+'px');
 const week=anchor?.week||addDays(el.dataset.selected,-(new Date(el.dataset.selected+'T12:00:00Z').getUTCDay()+6)%7);
 const item=$(`[data-week="${week}"]`,el);
 if(item)el.scrollTop=item.offsetTop+(anchor?.offset||0);
}
function mountMonthScroll(anchor){
 const el=$('.month-scroll');if(!el)return;positionMonths(el,anchor);let timer;
 monthResize=new ResizeObserver(()=>{if(el.isConnected){const saved=monthAnchor(el);positionMonths(el,saved)}});monthResize.observe(el);
 el.addEventListener('scroll',()=>{
  if(!el.isConnected||view!=='month'||tab!=='calendar'||page!=='main')return;
  const current=monthAnchor(el);
  if(current){if(selected<current.week||selected>addDays(current.week,13)){const last=CalendarNavigation.shift(monthWindow.at(-1),'month',1);selected=current.week<monthWindow[0]?monthWindow[0]:current.week>=last?addDays(last,-1):current.week}el.dataset.focus=selected;$('.month-title').textContent=dateLabel(addDays(current.week,3),{month:'long'});const year=$('.calendar-year');if(year)year.textContent=dateLabel(addDays(current.week,3),{year:'numeric'})}
  clearTimeout(timer);timer=setTimeout(async()=>{
   if(!el.isConnected||view!=='month'||page!=='main'||monthLoading||busy||calendarTouch.active()||calendarSwipe.active())return;
   const direction=el.scrollTop<180?-1:el.scrollHeight-el.clientHeight-el.scrollTop<180?1:0;if(!direction)return;
   monthLoading=true;const previous=[...monthWindow];
   try{
    const month=CalendarNavigation.shift(direction<0?monthWindow[0]:monthWindow.at(-1),'month',direction);
    if(direction<0)monthWindow.unshift(month);else monthWindow.push(month);
    if(monthWindow.length>7){if(direction<0)monthWindow.pop();else monthWindow.shift()}
    await loadData();if(el.isConnected)render();
   }catch(error){monthWindow=previous;toast(error.message)}finally{monthLoading=false}
  },100);
 },{passive:true});
}
function updateNowLines(root=document){
 const local=CalendarTime.local(new Date(),tz()),minutes=Number(local.slice(11,13))*60+Number(local.slice(14,16));
 $$('.now-line',root).forEach(el=>{const today=el.closest('.timeline').dataset.date===local.slice(0,10);el.hidden=!today;el.style.top=minutes/60*70+'px';el.setAttribute('aria-label',t('now')+' '+local.slice(11));el.dataset.time=local.slice(11)});
}
function positionTimeline(root=document,previous){
 updateNowLines(root);
 const el=$('.timeline',root);if(!el)return;
 if(previous?.day===el.dataset.date){el.scrollTop=previous.top;return}
 const now=CalendarTime.local(new Date(),tz()),minute=Number(now.slice(11,13))*60+Number(now.slice(14,16));
 const first=events.filter(e=>!e.all_day&&onDay(e,el.dataset.date)).map(e=>CalendarTime.local(e.start_utc,tz()).slice(11)).sort()[0];
 const target=el.dataset.date===now.slice(0,10)?minute:first?Number(first.slice(0,2))*60+Number(first.slice(3)):0;
 el.scrollTop=Math.max(0,target/60*70-el.clientHeight*.25);
}
async function openLinkedEvent(){
 const params=new URLSearchParams(location.search),id=params.get('event'),occ=params.get('occurrence')||'';
 if(!id||!state.calendar?.active)return false;
 params.delete('event');params.delete('occurrence');history.replaceState(null,'',location.pathname+(params.size?'?'+params.toString():'')+location.hash);
 tab='calendar';showSearch=false;query='';view='day';
 try{await openEvent(id,occ)}catch(error){if(['event_not_found','not_found','forbidden'].includes(error.code))toast(t('eventUnavailable'));else toast(error.message)}
 return true;
}
async function moveTimelineEvent(event,minute,startMinute){
 const oldScroll=$('.timeline')?.scrollTop;
 const original=CalendarTime.local(event.start_utc,tz());
 const continuing=original.slice(0,10)<selected;
 const target=continuing?Number(original.slice(11,13))*60+Number(original.slice(14,16))+minute-startMinute:minute;
 const changes=CalendarTime.moveEvent(event,continuing?original.slice(0,10):selected,target,tz());
 if(changes.start===event.start&&changes.end===event.end)return;
 const scope=event.rrule?await chooseScope():'all';if(!scope){render();return}
 busy=true;
 try{
  if(event.rrule&&scope!=='all')await api('events/'+event.id+'/occurrence','POST',{occurrence:event.occurrence,revision:event.revision,scope,changes});
  else{
   let patch=changes;
   if(event.rrule){const master=await api('events/'+event.id),delta=(Date.parse(changes.start+'Z')-Date.parse(event.start+'Z'))/60000;patch={...changes,start:CalendarTime.add(master.start,delta),end:CalendarTime.add(master.end,delta)}}
   const result=await api('events/'+event.id,'PATCH',{revision:event.revision,...patch});if(result.overlap_warning?.length)toast(t('overlap'));
  }
  await loadData();render();if(oldScroll!==undefined&&$('.timeline'))$('.timeline').scrollTop=oldScroll;toast(t('saved'));
 }catch(error){render();toast(t(error.message))}finally{busy=false}
}
setInterval(()=>{if(state)updateNowLines()},30000);

function reminderChoices(values,name='reminder'){return `<div class="reminders">${[1440,720,120,60,30,15].map(n=>`<label><input type="checkbox" name="${name}" value="${n}" ${values.includes(n)?'checked':''}>${reminderLabel(n)}</label>`).join('')}</div>`}
function recurrenceEditor(e){
 const c=CalendarRecurrence.parse(e.rrule,e.start,e.timezone),dayNames=CalendarRecurrence.DAYS.map((d,i)=>[d,dateLabel(addDays('2026-10-19',i),{weekday:'short'})]);
 const row=(k,html)=>`<div class="form-row">${field(k,html)}</div>`;
 return `${row('repeat',select('repeat',[['',t('none')],['DAILY',t('daily')],['WEEKLY',t('weekly')],['MONTHLY',t('monthly')],['YEARLY',t('yearly')],...(c.preserve?[['preserve',t('preserveRule')]]:[])],c.freq))}${c.freq==='preserve'?`<p class="form-note privacy">${t('preserveRuleHelp')}</p>`:c.freq?`<div class="recurrence-editor">${row('repeatEvery',`<div class="repeat-interval">${input('repeat-interval',c.interval,'number','min="1" max="10000" required')}<span>${t({DAILY:'repeatUnitDays',WEEKLY:'repeatUnitWeeks',MONTHLY:'repeatUnitMonths',YEARLY:'repeatUnitYears'}[c.freq])}</span></div>`)}${c.freq==='WEEKLY'?`<fieldset class="weekday-options"><legend>${t('weekdays')}</legend>${dayNames.map(([v,l])=>`<label><input type="checkbox" name="repeat-day" value="${v}" ${c.days.includes(v)?'checked':''}><span>${esc(l)}</span></label>`).join('')}</fieldset>`:''}${c.freq==='MONTHLY'?`${row('monthPattern',select('repeat-month-mode',[['date',t('byDate')],['ordinal',t('byWeekday')]],c.monthMode))}${c.monthMode==='date'?row('monthDay',input('repeat-month-day',c.monthDay,'number','min="1" max="31" required')):`${row('ordinal',select('repeat-ordinal',[[1,'firstOrdinal'],[2,'secondOrdinal'],[3,'thirdOrdinal'],[4,'fourthOrdinal'],[5,'fifthOrdinal'],[-1,'lastOrdinal']].map(([v,k])=>[String(v),t(k)]),String(c.ordinal)))}${row('weekday',select('repeat-weekday',dayNames,c.weekday))}`}<p class="form-note privacy">${t('shortMonthHelp')}</p>`:''}${row('repeatEnd',select('repeat-end',[['never',t('neverEnd')],['date',t('onDate')],['count',t('afterCount')]],c.endMode))}${c.endMode==='date'?row('repeatUntil',input('repeat-until',c.until,'date','required min="'+esc(e.start.slice(0,10))+'"')):c.endMode==='count'?row('repeatCount',input('repeat-count',c.count,'number','required min="1" max="10000"')):''}</div>`:''}`;
}
function readRecurrence(d,e){
 const c=CalendarRecurrence.parse(e.rrule,d.get('start')||e.start,d.get('timezone')||e.timezone);c.freq=d.get('repeat');
 c.interval=Number(d.get('repeat-interval')||c.interval);c.endMode=d.get('repeat-end')||c.endMode;
 c.days=d.has('repeat-day')?d.getAll('repeat-day'):(c.freq==='WEEKLY'&&d.has('repeat-interval')?[]:c.days);
 c.monthMode=d.get('repeat-month-mode')||c.monthMode;c.monthDay=Number(d.get('repeat-month-day')||c.monthDay);
 c.ordinal=Number(d.get('repeat-ordinal')||c.ordinal);c.weekday=d.get('repeat-weekday')||c.weekday;
 c.until=d.get('repeat-until')||c.until;c.count=Number(d.get('repeat-count')||c.count);
 const zone=d.get('timezone')||e.timezone,value=CalendarRecurrence.build(c,zone);
 const original=CalendarRecurrence.parse(e.rrule,d.get('start')||e.start,zone);
 return value===CalendarRecurrence.build(original,zone)?e.rrule:value;
}
async function occurrenceDialog(){
 const id=currentEvent.id,el=document.createElement('div');el.className='modal-backdrop';
 el.innerHTML=`<div class="modal occurrence-picker" role="dialog" aria-modal="true"><div class="row spread"><h2>${t('otherOccurrences')}</h2><button type="button" data-close aria-label="${t('close')}">×</button></div><label>${t('occurrencesMonth')}<input type="month" value="${esc(eventDay(currentEvent).slice(0,7))}"></label><div class="occurrence-results"></div></div>`;
 document.body.append(el);let request=0;
 const refresh=async()=>{const version=++request,month=$('input',el).value;if(!/^\d{4}-\d{2}$/.test(month))return;const first=month+'-01',d=new Date(first+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);const end=d.toISOString().slice(0,10);$('.occurrence-results',el).textContent=t('loading');try{const rows=await api('events/'+id+'/instances?'+new URLSearchParams({start:addDays(first,-2),end:addDays(end,2)}));if(version!==request||!el.isConnected)return;$('.occurrence-results',el).innerHTML=rows.filter(e=>eventDay(e)>=first&&eventDay(e)<end).map(e=>`<button type="button" data-occ="${esc(e.occurrence)}"><strong>${esc(dateLabel(eventDay(e),{day:'numeric',month:'short'}))} · ${esc(time(e))}</strong><small>${esc(title(e))} · ${t(e.status)}</small></button>`).join('')||`<p class="privacy">${t('noOccurrences')}</p>`}catch(err){$('.occurrence-results',el).textContent=err.message}};
 $('input',el).onchange=refresh;el.onclick=async ev=>{const b=ev.target.closest('button');if(!b)return;if(b.hasAttribute('data-close')){el.remove();return}if(b.dataset.occ){el.remove();try{await openEvent(id,b.dataset.occ)}catch(err){toast(err.message)}}};await refresh();$('input',el).focus();
}
function recurrenceLabel(e){
 const c=CalendarRecurrence.parse(e.rrule,e.start,e.timezone);if(!c.freq)return t('none');if(c.freq==='preserve')return t('preserveRule');
 let text=t({DAILY:'daily',WEEKLY:'weekly',MONTHLY:'monthly',YEARLY:'yearly'}[c.freq]);if(c.interval>1)text+=' · '+t('repeatEvery').toLowerCase()+' '+c.interval+' '+t({DAILY:'repeatUnitDays',WEEKLY:'repeatUnitWeeks',MONTHLY:'repeatUnitMonths',YEARLY:'repeatUnitYears'}[c.freq]);
 if(c.freq==='WEEKLY')text+=' · '+c.days.map(d=>dateLabel(addDays('2026-10-19',CalendarRecurrence.DAYS.indexOf(d)),{weekday:'short'})).join(', ');
 if(c.freq==='MONTHLY')text+=' · '+(c.monthMode==='date'?c.monthDay:t({1:'firstOrdinal',2:'secondOrdinal',3:'thirdOrdinal',4:'fourthOrdinal',5:'fifthOrdinal','-1':'lastOrdinal'}[c.ordinal])+' '+dateLabel(addDays('2026-10-19',CalendarRecurrence.DAYS.indexOf(c.weekday)),{weekday:'long'}));
 if(c.endMode==='count')text+=' · '+c.count+' '+t('repeatCount').toLowerCase();if(c.endMode==='date')text+=' · '+t('onDate').toLowerCase()+' '+dateLabel(c.until,{day:'numeric',month:'short',year:'numeric'});return text;
}
function eventForm(){
 const e=formEvent,all=e.all_day,repeat=e.rrule?((/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(e.rrule))?e.rrule.split('=')[1]:'custom'):'';
 const row=(label,content)=>`<div class="form-row">${field(label,content)}</div>`;
 return `<form id="event-form" class="event-form"><div id="form-error" class="error" role="alert"></div><section class="form-group basic-fields"><div class="title-field">${field('title',input('title',e.title,'text',`required maxlength="300" placeholder="${t('title')}"`))}</div><label class="switch-row">${t('allDay')}<input type="checkbox" role="switch" name="all_day" ${all?'checked':''}></label>${row('start',input('start',all?e.start:e.start.slice(0,16),all?'date':'datetime-local','required'))}${row('end',input('end',all?e.end:e.end.slice(0,16),all?'date':'datetime-local','required'))}</section><details class="advanced-section" ${e.advanced!==false?'open':''}><summary>${t('advanced')}<span>⌃</span></summary><section class="form-group">${row('owner',radioSegment('owner',[[state.me.id,t('mine')],...state.members.filter(x=>x.id!==state.me.id).map(x=>[x.id,t('partner')]),['both',t('both')]],e.owner))}${row('category',select('category_id',[['',t('noCategory')],...categories.map(c=>[c.id,catName(c.id)])],e.category_id||''))}${row('timezone',input('timezone',e.timezone,'text','required list="timezones"'))}${recurrenceEditor(e)}</section><section class="form-group">${row('location',input('location',e.location))}<div class="form-note">${field('links',`<textarea name="links" rows="2">${esc(e.links.join('\n'))}</textarea>`)}</div><div class="form-note">${field('description',`<textarea name="description" rows="3">${esc(e.description)}</textarea>`)}</div></section><details class="translation-fields"><summary>${t('showTranslations')}</summary><section class="form-group"><p class="privacy">${t('translationHelp')}</p>${['ru','en'].map(lang=>`<div class="field"><label for="title-${lang}">${lang.toUpperCase()} · ${t('title')}</label><input id="title-${lang}" name="title_${lang}" value="${esc(e.translations?.[lang]?.title||'')}"><label for="description-${lang}">${lang.toUpperCase()} · ${t('description')}</label><textarea id="description-${lang}" name="description_${lang}">${esc(e.translations?.[lang]?.description||'')}</textarea></div>`).join('')}</section></details><details class="dst-fields"><summary>${t('repeatedHour')}</summary><p class="muted">${t('ambiguous')}</p><div class="fields">${field('start',select('fold',[['','—'],['0',t('firstFold')],['1',t('secondFold')]],e.fold===undefined?'':String(e.fold)))}${field('end',select('end_fold',[['','—'],['0',t('firstFold')],['1',t('secondFold')]],e.end_fold===undefined?'':String(e.end_fold)))}</div></details><section class="form-group reminder-group"><h3>${t('eventReminders')}</h3>${reminderChoices(e.reminders?.[state.me.id]||[])}<p class="privacy">${t('eventReminderHelp')}</p></section></details><datalist id="timezones">${['Europe/Warsaw','Europe/Amsterdam','Europe/Kyiv','Europe/London','Australia/Melbourne','UTC'].map(v=>`<option value="${v}">`).join('')}</datalist></form>`;
}
function detail(){
 const e=currentEvent;if(!e)return '';
 const lang=detailLanguage||state.me.language,tr=e.translations?.[lang];
 const when=e.all_day?dateLabel(e.start,{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+t('allDay'):`${zoned(e.start_utc,{weekday:'short',day:'numeric',month:'long'})} · ${time(e)} – ${zoned(e.end_utc,{hour:'2-digit',minute:'2-digit'})}`;
 const content=tr?.description||e.description;
 return `<article class="event-detail"><div class="detail-badges"><span class="category-chip" data-bg="${color(e.category_id)}">${esc(catName(e.category_id))}</span>${button('status-options',t(e.status),'status-chip',`aria-label="${t('changeStatus')}" aria-haspopup="dialog"`)}<span class="owner-chip">${ownership(e.owner)}</span></div><h1 class="detail-title">${esc(tr?.title||e.title)}</h1><section class="form-group"><div class="detail-block with-icon">${icon('clock')}<div><strong>${esc(when)}</strong><small>${t('yourTime')} · ${esc(tz())}</small>${!e.all_day&&e.timezone!==tz()?`<div class="source-time"><span>${t('sourceTime')}</span><br>${esc(e.start.replace('T',' '))} → ${esc(e.end.replace('T',' '))}<br>${esc(e.timezone)}</div>`:''}</div></div>${e.rrule?`<div class="detail-block with-icon">${icon('repeat')}<div><span class="muted">${t('repeat')}</span><p>${esc(recurrenceLabel(e))}</p>${button('other-occurrences',t('otherOccurrences'),'text-button')}</div></div>`:''}</section>${e.location||e.links.length?`<section class="form-group"><div class="detail-block with-icon">${icon('pin')}<div><h3><strong>${t('location')}</strong></h3>${e.location?`<p>${esc(e.location)}</p>`:''}${e.links.map(l=>`<p><a href="${esc(l)}" target="_blank" rel="noreferrer noopener">${esc(l)}</a></p>`).join('')}</div></div></section>`:''}${content||Object.keys(e.translations||{}).length?`<section class="form-group description-card"><div class="row spread"><h3><strong>${t('description')}</strong></h3><div class="segment language-segment">${['en','ru'].map(l=>button('detail-language',l.toUpperCase(),lang===l?'active':'',`data-lang="${l}" aria-pressed="${lang===l}"`)).join('')}</div></div><p>${esc(content)}</p>${tr?.stale?`<small>${t('stale')}</small>`:''}${cfg.integrations?.translation==='configured'?button('translate-event',t('translateAgain'),'text-button'):''}</section>`:''}<section class="form-group"><div class="detail-block"><div class="row spread"><h3>${t('reminders')}</h3>${button('edit-event',t('edit'),'text-button')}</div><small>${t('personalReminders')}</small><p>${state.me.notify_at_start!==false?esc(t('notify_at_start'))+'<br>':''}${(e.reminders[state.me.id]||[]).map(reminderLabel).join(' · ')||'—'}</p><small>${t('partnerReminders')}</small></div></section>${e.translation_status?.state==='pending'?`<p class="privacy">${t('translationQueued')}</p>`:e.translation_status?.state==='failed'?`<p class="error">${t('translationFailed')}</p>`:''}${cfg.integrations?.translation==='configured'&&Object.values(e.translations||{}).some(v=>v.manual)?button('replace-translations',t('replaceManual'),'text-button danger'):''}${cfg.integrations?.translation==='configured'&&!content&&!Object.keys(e.translations||{}).length?button('translate-event',t('translateAgain'),'text-button'):''}<div class="detail-actions">${button('set-status',t(e.status==='done'?'resumeEvent':'markDone'),'soft-button',`data-status="${e.status==='done'?'planned':'done'}"`)}${button('delete-event',t('delete'),'danger destructive')}</div></article>`;
}
function eventStatusDialog(){
 const e=currentEvent;if(!e)return;
 const el=document.createElement('div');el.className='modal-backdrop';
 el.innerHTML=`<div class="modal event-status-picker" role="dialog" aria-modal="true"><h2>${t('changeStatus')}</h2>${['planned','done','cancelled'].map(status=>button('choose-event-status',t(status),'status-choice',`data-status="${status}" ${e.status===status?'disabled':''}`)).join('')}${button('close-status-options',t('cancel'),'plain full')}</div>`;
 el.addEventListener('click',async event=>{const target=event.target.closest('[data-action]');if(!target||busy)return;if(target.dataset.action==='close-status-options'){el.remove();return}if(target.dataset.action!=='choose-event-status')return;busy=true;try{await changeEventStatus(e,target.dataset.status);el.remove();await openEvent(e.id,e.occurrence)}catch(error){toast(error.message)}finally{busy=false}});
 document.body.append(el);el.querySelector('button:not([disabled])')?.focus();
}
function categoriesPage(){return `<div class="page-title-row">${!touchBarItems().includes('categories')?button('back-to-settings',`${icon('prev')}${t('back')}`,'category-back'):''}<h1>${t('categories')}</h1>${button('new-category','+ '+t('newCategory'),'text-button')}</div><div class="categories-grid form-group">${categories.map(c=>`<button class="category-card" type="button" data-action="edit-category" data-id="${c.id}"><span class="dot" data-bg="${c.color}"></span><span class="grow">${esc(catName(c.id))}<small>${t('sharedCategories')}</small></span>${icon('next')}</button>`).join('')}</div>${!categories.length?empty():''}`}
function statusSection(){
 if(!systemStatus)return '';
 const status=systemStatus,b=status.backup;const backupText=b.state==='ready'?t('backupReady'):b.state==='pending'?t('backupPending'):b.state==='not_configured'?t('backupUnavailable'):t('serviceDelayed');
 return `<h3 class="section-label">${t('systemStatus')}</h3><section class="form-group"><div class="setting-row"><span>Telegram</span><small>${status.ready?t('serviceReady'):t('serviceDelayed')}</small></div><div class="setting-row"><span>${t('translations')}</span><small>${status.translation.state==='ready'?t('serviceReady'):t('serviceDelayed')}</small></div><div class="form-note"><strong>${t('automaticBackups')}</strong><p>${backupText}</p>${b.last_success?`<small>${t('lastBackup')}: ${esc(zoned(b.last_success,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</small>`:''}</div></section>`;
}
function settingsPage(){
 const me=state.me,votes=state.calendar.votes;
 return `<h1 class="page-title">${t('settings')}</h1><div class="pair-card"><div class="members">${(state.members||[]).map(m=>`<span class="avatar">${esc(m.name?.slice(0,1)||'?')}</span>`).join('')}</div><div><strong>${t('pairTitle')}</strong><small>${(state.members||[]).length} / 2 ${t('seats')}</small></div></div><h3 class="section-label">${t('justYou')}</h3><section class="form-group settings-group"><div class="setting-row"><label for="setting-language">${t('language')}</label><select id="setting-language" name="setting-language">${[['ru','Русский'],['en','English']].map(([v,l])=>opt(v,l,me.language)).join('')}</select></div><div class="setting-row theme-row"><span>${t('theme')}</span><div class="segment">${['light','dark','system'].map(v=>button('theme',t(v),me.theme===v?'active':'',`data-theme="${v}" aria-pressed="${me.theme===v}"`)).join('')}</div></div><div class="setting-row touchbar-settings-row">${button('touchbar',`<span class="grow">${t('touchBar')}</span>${icon('next')}`,'setting-link')}</div><div class="setting-row categories-settings-row">${button('tab',`<span class="grow">${t('categories')}</span>${icon('next')}`,'setting-link','data-tab="categories"')}</div><div class="setting-row"><label for="setting-timezone">${t('timezone')}</label><input id="setting-timezone" name="setting-timezone" value="${esc(me.timezone)}"></div><div class="setting-row"><label for="setting-day_layout">${t('defaultDayLayout')}</label><select id="setting-day_layout" name="setting-day_layout">${[['list',t('dayList')],['timeline',t('dayTimeline')]].map(([v,l])=>opt(v,l,me.day_layout)).join('')}</select></div><div class="setting-row"><label for="setting-month_layout">${t('month_layout')}</label><select id="setting-month_layout" name="setting-month_layout">${[['paged',t('monthPaged')],['scroll',t('monthScroll')]].map(([v,l])=>opt(v,l,me.month_layout||'paged')).join('')}</select></div><details class="default-settings"><summary>${t('defaults')}<small>${me.default_reminders.map(x=>x>=60?x/60+' h':x+' min').join(' · ')||'—'} ›</small></summary><div class="reminder-options"><p class="privacy">${t('defaultHelp')}</p>${reminderChoices(me.default_reminders,'default-reminder')}</div></details><div class="setting-row"><label for="duration-preset">${t('default_duration')}</label><select id="duration-preset" name="duration-preset">${[['30',t('duration30')],['60',t('duration60')],['120',t('duration120')],['custom',t('durationOther')]].map(([v,l])=>opt(v,l,[30,60,120].includes(me.default_duration)?String(me.default_duration):'custom')).join('')}</select></div><div class="setting-row" id="custom-duration-row" ${[30,60,120].includes(me.default_duration)?'hidden':''}><label for="setting-default_duration">${t('durationMinutes')}</label><input id="setting-default_duration" name="setting-default_duration" type="number" min="1" max="525600" step="1" required value="${me.default_duration||60}"></div><label class="switch-row">${t('notify_at_start')}<input type="checkbox" role="switch" name="setting-notify_at_start" ${me.notify_at_start!==false?'checked':''}></label><label class="switch-row">${t('enabled')}<input type="checkbox" role="switch" name="setting-reminders_enabled" ${me.reminders_enabled?'checked':''}></label><div class="delivery-row"><span>${t('openBot')}</span><span class="delivery-status ${me.bot_can_message&&!me.delivery_error?'ok':''}">${me.bot_can_message&&!me.delivery_error?t('deliveryOk'):t('deliveryError')}</span></div>${!me.bot_can_message||me.delivery_error?`<div class="form-note"><p class="privacy">${t('botStart')}</p>${button('open-bot',t('openBot'),'full')}</div>`:''}</section>${statusSection()}${!state.calendar.second_id?`<section class="form-group padded"><h3>${t('invite')}</h3><p class="privacy">${t('inviteHelp')}</p>${button('invite',t('invite'),'primary full')}${inviteUrl?`<p class="privacy">${esc(inviteUrl)}</p>${button('copy-invite',t('copy'),'full')}`:''}</section>`:''}<h3 class="section-label">${t('connectedCalendars')}</h3><section class="form-group"><div class="provider-row"><span class="provider-icon">G</span><span class="grow">Google<small>${t('notConnected')}</small></span><small>${t('notAvailable')}</small></div><div class="provider-row"><span class="provider-icon">i</span><span class="grow">Apple iCloud<small>${t('notConnected')}</small></span><small>${t('notAvailable')}</small></div></section><p class="privacy section-footnote">${t('integrationsInfo')}</p><h3 class="section-label">${t('sharedData')}</h3><section class="form-group settings-links">${button('trash',`${icon('trash')}<span class="grow">${t('trash')}</span>${icon('next')}`,'setting-link')}${button('backup',`${icon('archive')}<span class="grow">${t('backupExport')}</span><small>ICS · ZIP</small>${icon('next')}`,'setting-link')}</section><h3 class="section-label">${t('leaveOrDelete')}</h3><section class="form-group settings-links">${button('leave',t('leave'),'setting-link danger')}${votes.length?`<div class="notice">${votes.includes(me.id)?t('deletionPending'):t('deletionRequested')}</div>`:''}${!votes.includes(me.id)?button('approve-deletion',`<span>${t('deleteCalendar')}<small>${t('deleteHelp')}</small></span>`,'setting-link danger'):''}${votes.length?button('reject-deletion',t('reject'),'setting-link'):''}</section>`;
}
function trashPage(){return `${button('back',`‹ ${t('back')}`,'plain back')}<h2>${t('trash')}</h2><p class="muted">${t('trashHelp')}</p>${events.map(e=>`<div class="card"><h3>${esc(title(e))}</h3><p class="muted">${esc(e.start)} · ${esc(e.deleted_at.slice(0,10))}</p><div class="row">${button('restore-event',t('restore'),'primary',`data-id="${e.id}" data-revision="${e.revision}" data-occ="${esc(e.occurrence||'')}"`)}${button('permanent-event',t('deleteForever'),'danger',`data-id="${e.id}" data-revision="${e.revision}" data-occ="${esc(e.occurrence||'')}"`)}</div></div>`).join('')||empty()}`}
function backupPage(){
 let html=`${button('back',`‹ ${t('back')}`,'plain back')}<h2>${t('backup')}</h2><div class="card"><div class="row wrap">${button('download-zip',t('downloadZip'),'primary')}${button('download-ics',t('downloadIcs'))}</div></div><div class="card"><h3>${t('restoreZip')}</h3><input id="archive-file" type="file" accept=".zip,application/zip" aria-label="${t('chooseFile')}"><p></p>${button('preview-backup',t('preview'),'full')}</div>`;
 if(previewData){html+=`<div class="card"><h2>${t('archivePreview')}</h2><p class="muted">${t('archiveInfo')}</p><div class="scrollbox"><h3>${t('categories')}</h3>${previewData.categories.map(c=>`<label class="check-label"><input class="backup-category" type="checkbox" value="${c.id}">${esc(c.data.name)}</label>`).join('')}<h3>${t('differences')}</h3>${previewData.changes.map(e=>`<div>${Object.entries(e.fields).map(([k,v])=>`<div class="backup-field"><label class="check-label"><input type="checkbox" class="backup-field-choice" data-id="${e.id}" data-revision="${e.revision}" data-occ="${esc(e.occurrence||'')}" value="${k}">${t(k)}</label><small>${t('current')}</small><pre>${esc(JSON.stringify(v.current))}</pre><small>${t('archive')}</small><pre>${esc(JSON.stringify(v.archive))}</pre></div>`).join('')}</div>`).join('')||`<p class="muted">${t('noDifferences')}</p>`}<h3>${t('recurrenceExceptions')}</h3>${previewData.override_changes.map(e=>`<div class="backup-field"><p>${esc(e.occurrence)}</p>${Object.entries(e.fields).map(([k,v])=>`<label class="check-label"><input type="checkbox" class="backup-override" data-id="${e.id}" data-occ="${esc(e.occurrence)}" data-revision="${e.revision}" value="${esc(k)}">${t(k)}</label><small>${t('current')}</small><pre>${esc(JSON.stringify(v.current))}</pre><small>${t('archive')}</small><pre>${esc(JSON.stringify(v.archive))}</pre>`).join('')}</div>`).join('')}<h3>${t('mySettings')}</h3>${Object.entries(previewData.profile).map(([k,v])=>`<div class="backup-field"><label class="check-label"><input type="checkbox" class="backup-profile" value="${esc(k)}">${t(k)}</label><small>${t('current')}</small><pre>${esc(JSON.stringify(v.current))}</pre><small>${t('archive')}</small><pre>${esc(JSON.stringify(v.archive))}</pre></div>`).join('')}<h3>${t('missing')}</h3>${previewData.missing.map(e=>`<label class="check-label"><input type="checkbox" class="backup-missing" value="${e.id}">${esc(e.data.title)} · ${esc(e.data.start)}</label>`).join('')}</div>${button('apply-backup',t('applySelected'),'primary full')}</div>`}
 return html;
}
async function refresh(){state=await api('state');await loadData();render()}
function activeNavigation(){return tab==='calendar'?view:tab}
function navigationTarget(action){return {date:action.type==='move'?CalendarNavigation.shift(selected,view,action.direction):selected,mode:action.type==='view'?action.view:view,tab:action.type==='tab'?action.tab:'calendar'}}
function atCalendarTarget(target,rows,fn){
 const old={selected,view,events,monthWindow,tab,categories,systemStatus};monthWindow=[...monthWindow];
 try{selected=target.date;view=target.mode;tab=target.tab||'calendar';if(rows){if(tab==='calendar')events=rows;else if(tab==='categories')categories=rows;else systemStatus=rows}return fn()}
 finally{selected=old.selected;view=old.view;events=old.events;monthWindow=old.monthWindow;tab=old.tab;categories=old.categories;systemStatus=old.systemStatus}
}
function navigationEntry(target){
 if(target.tab&&target.tab!=='calendar'){
  const key='tab:'+target.tab;if(navigationCache.has(key))return navigationCache.get(key);
  const entry={rows:null,promise:null};entry.promise=api(target.tab==='categories'?'categories':'system-status').then(rows=>{entry.rows=rows;return rows}).catch(error=>{navigationCache.delete(key);throw error});entry.promise.catch(()=>{});navigationCache.set(key,entry);while(navigationCache.size>12)navigationCache.delete(navigationCache.keys().next().value);return entry;
 }
 const params=atCalendarTarget(target,null,()=>{
  const days=calendarRange();
  return new URLSearchParams({start:addDays(days[0],-1),end:addDays(days.at(-1),2),q:'',...filter});
 });
 const key=params.toString();
 if(navigationCache.has(key))return navigationCache.get(key);
 const entry={rows:null,promise:null};
 entry.promise=api('events?'+params).then(rows=>{entry.rows=rows;return rows}).catch(error=>{if(navigationCache.get(key)===entry)navigationCache.delete(key);throw error});
 // Speculative requests may fail; the navigation path still reports a real failure.
 entry.promise.catch(()=>{});navigationCache.set(key,entry);
 while(navigationCache.size>12)navigationCache.delete(navigationCache.keys().next().value);
 return entry;
}
function warmNavigation(){
 if(tab!=='calendar'||page!=='main'||showSearch||!state.calendar?.active)return;
 const modes=touchBarItems(),i=modes.indexOf(view);
 for(const direction of [-1,1])navigationEntry(navigationTarget({type:'move',direction}));
 for(const mode of (i<0?[]:[modes[i-1],modes[i+1]]).filter(mode=>['day','week','month'].includes(mode)))navigationEntry({date:selected,mode});
}
function navigationPage(target,rows){
 const node=document.createElement('div');node.className='calendar-motion-page';node.dataset.view=target.tab==='calendar'?target.mode:target.tab;
 node.innerHTML=atCalendarTarget(target,rows||(target.tab==='calendar'?[]:null),()=>tab==='calendar'?calendarPage():`<div class="navigation-content">${tab==='categories'?categoriesPage():settingsPage()}</div>`);paint(node);positionTimeline(node);requestAnimationFrame(()=>{positionTimeline(node);node.dataset.timelineScroll=$('.timeline',node)?.scrollTop||0;const el=$('.month-scroll',node);if(el)positionMonths(el)});
 if(!rows){const loading=document.createElement('span');loading.className='calendar-preview-loading';loading.textContent=t('loading');node.append(loading)}
 return node;
}
function navigationPreview(action){
 const target=navigationTarget(action),entry=navigationEntry(target),node=navigationPage(target,entry.rows);
 if(!entry.rows)entry.promise.then(rows=>{
  if(!node.isConnected)return;
  node.replaceChildren(...navigationPage(target,rows).childNodes);
  positionTimeline(node);const months=$('.month-scroll',node);if(months)positionMonths(months);
 }).catch(()=>{});
 return node;
}
async function navigateSmoothly(action,motion){
 if(!action.direction&&['view','tab'].includes(action.type)){const items=touchBarItems();action={...action,direction:items.indexOf(action.view||action.tab)>items.indexOf(activeNavigation())?1:-1}}
 const target=navigationTarget(action),rows=await navigationEntry(target).promise;
 const ready=action.type==='view'?api('settings','PATCH',{view:target.mode}):Promise.resolve();
 const commit=()=>{selected=target.date;view=target.mode;tab=target.tab;state.me.view=view;if(tab==='calendar')events=rows;else if(tab==='categories')categories=rows;else systemStatus=rows;render();warmNavigation()};
 if(motion)await motion.finish(action,navigationPage(target,rows),commit,ready);else{await ready;commit()}
}
async function loadData(){
 const version=++fetchVersion;navigationCache.clear();
 if(!state.calendar?.active||state.calendar.state!=='active')return;
 if(page==='form'||page==='detail')return;
 categories=await api('categories');
 if(page==='trash'){events=await api('events?trash=true');return}
 if(tab==='settings'&&page==='main')systemStatus=await api('system-status');
 if(tab!=='calendar'||page==='backup')return;
 const days=calendarRange();
 const params=new URLSearchParams({start:addDays(days[0],-1),end:addDays(days.at(-1),2),q:query,...filter});
 const result=await api('events?'+params);if(version===fetchVersion){events=result;if(!query)navigationCache.set(params.toString(),{rows:result,promise:Promise.resolve(result)});warmNavigation()}
}
async function changeView(v){view=v;state.me.view=v;await api('settings','PATCH',{view:v});await loadData();render()}
async function openEvent(id,key){
 const master=await api('events/'+id+(key?'?occurrence='+encodeURIComponent(key):''));
 detailLanguage=state.me.language;
 currentEvent={...master,...(master.selected_instance||master.first_instance||{}),master};
 selected=eventDay(currentEvent);page='detail';render();
}
function captureForm(){
 const f=$('#event-form');if(!f)return;const d=new FormData(f);
 formEvent={...formEvent,title:d.get('title'),start:d.get('start'),end:d.get('end'),all_day:d.has('all_day'),owner:d.get('owner'),category_id:d.get('category_id')||null,timezone:d.get('timezone'),location:d.get('location'),description:d.get('description'),links:d.get('links').split('\n').map(x=>x.trim()).filter(Boolean),rrule:readRecurrence(d,formEvent),advanced:$('.advanced-section')?.open,fold:!d.get('fold')&&d.get('fold')!=='0'?undefined:Number(d.get('fold')),end_fold:!d.get('end_fold')&&d.get('end_fold')!=='0'?undefined:Number(d.get('end_fold')),
 reminders:{...formEvent.reminders,[state.me.id]:d.getAll('reminder').map(Number)},translations:{...formEvent.translations}};
 for(const lang of ['ru','en']){const title=d.get('title_'+lang),description=d.get('description_'+lang);const old=formEvent.translations?.[lang];if((title||description||old)&&(title!==(old?.title||'')||description!==(old?.description||'')))formEvent.translations[lang]={title,description,manual:true,stale:false}}
}
function confirmDialog(title,message=''){return new Promise(resolve=>{const el=document.createElement('div');el.className='modal-backdrop';el.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${message?`<p class="muted">${esc(message)}</p>`:''}<button class="danger" data-choice="yes">${t('approve')}</button><button data-choice="no">${t('cancel')}</button></div>`;document.body.append(el);const finish=answer=>{el.remove();resolve(answer)};el.addEventListener('click',e=>{const c=e.target.closest('[data-choice]');if(c)finish(c.dataset.choice==='yes')});$('[data-choice=no]',el).focus()})}
function chooseScope(){return new Promise(resolve=>{const el=document.createElement('div');el.className='modal-backdrop';el.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><h2>${t('occurrenceScope')}</h2>${[['one','one'],['following','following'],['all','series']].map(([v,k])=>`<button data-choice="${v}">${t(k)}</button>`).join('')}<button data-choice="cancel">${t('cancel')}</button></div>`;document.body.append(el);el.addEventListener('click',e=>{const c=e.target.closest('[data-choice]');if(c){el.remove();resolve(c.dataset.choice==='cancel'?null:c.dataset.choice)}});$('button',el).focus()})}
async function saveForm(){
 try{captureForm()}catch(err){$('#form-error').textContent=t(err.message);return}const e=formEvent;
 const payload={};for(const k of ['title','description','start','end','all_day','timezone','owner','category_id','location','links','rrule','translations','fold','end_fold'])if(e[k]!==undefined)payload[k]=e[k];
 payload.reminders=e.reminders[state.me.id];
 try{
  let result;
  if(currentEvent?.rrule&&formScope!=='all'){
   result=await api('events/'+currentEvent.id+'/occurrence','POST',{occurrence:currentEvent.occurrence,revision:currentEvent.revision,scope:formScope,changes:payload});
  }else result=await api(currentEvent?'events/'+currentEvent.id:'events',currentEvent?'PATCH':'POST',{...payload,...(currentEvent?{revision:currentEvent.revision}:{})});
  toast(result.overlap_warning?.length?t('overlap'):t('saved'));
  const id=result.id||currentEvent?.id;page='main';await loadData();await openEvent(id,result.occurrence||undefined);
 }catch(e){$('#form-error').textContent=e.message;$('#form-error').scrollIntoView({behavior:'smooth',block:'center'})}
}
async function fileBase64(selector){const file=$(selector)?.files?.[0];if(!file)throw new Error(t('chooseFile'));if(file.size>10*1024*1024)throw new Error('ZIP > 10 MB');return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file)})}
async function download(path,name){const blob=await api(path,'GET',null,true);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}
const actions={
 'choose-language':async el=>{state=await api('settings','PATCH',{language:el.dataset.lang});await loadData();render()},
 'translate-event':async()=>{await api('events/'+currentEvent.id+'/translate','POST',{});currentEvent.translation_status={state:'pending'};render();toast(t('translationQueued'))},
 'replace-translations':async()=>{if(await confirmDialog(t('replaceManual'),t('replaceManualHelp'))){await api('events/'+currentEvent.id+'/translate','POST',{overwrite_manual:true});currentEvent.translation_status={state:'pending'};render();toast(t('translationQueued'))}},
 'touchbar':()=>{page='touchbar';render()},
 'back-to-settings':async()=>{tab='settings';page='main';await loadData();render()},
 'touchbar-move':el=>{const items=[...touchBarItems()],i=items.indexOf(el.dataset.item),j=i+Number(el.dataset.direction);if(i<0||j<0||j>=items.length-1)return;[items[i],items[j]]=[items[j],items[i]];return saveTouchBar(items)},
 'nav-view':async el=>{if(tab==='calendar'&&page==='main'&&!showSearch){if(view!==el.dataset.view)await navigateSmoothly({type:'view',view:el.dataset.view},CalendarNavigation.motion({preview:navigationPreview}));return}tab='calendar';page='main';showSearch=false;query='';await changeView(el.dataset.view)},
 'tab':async el=>{tab=el.dataset.tab;page='main';showSearch=false;query='';await loadData();render()},
 'view':el=>el.dataset.view===view?undefined:navigateSmoothly({type:'view',view:el.dataset.view},CalendarNavigation.motion({preview:navigationPreview})),
 'day-layout':async el=>{state=await api('settings','PATCH',{day_layout:el.dataset.layout});render()},
 'month-layout':async()=>{const month_layout=state.me.month_layout==='scroll'?'paged':'scroll';state=await api('settings','PATCH',{month_layout});await loadData();render()},
 'month-day-list':async el=>{selected=el.dataset.date;state=await api('settings','PATCH',{month_layout:'paged'});await loadData();render()},
 'toggle-day-done':async el=>{const e=listedEvent(el);await changeEventStatus(e,e.status==='done'?'planned':'done');await loadData();render()},
 'delete-day-event':el=>deleteCalendarEvent(listedEvent(el)),
 'search':async()=>{showSearch=!showSearch;if(!showSearch)query='';await loadData();render();$('#search')?.focus()},
 'clear-search':async()=>{query='';await loadData();render();$('#search')?.focus()},
 'reset-filters':async()=>{filter={owner:'',category:'',status:''};await loadData();render()},
 'close-app':()=>tg?.close(),
 'detail-language':el=>{detailLanguage=el.dataset.lang;render()},
 'status-options':()=>eventStatusDialog(),
 'set-status':async el=>{const e=currentEvent,value=el.dataset.status;if(e.rrule)await api('events/'+e.id+'/occurrence','POST',{occurrence:e.occurrence,revision:e.revision,scope:'one',changes:{status:value}});else await api('events/'+e.id,'PATCH',{revision:e.revision,status:value});await openEvent(e.id,e.occurrence)},
 'other-occurrences':()=>occurrenceDialog(),
 'filters':()=>filterDialog(),
 'today':async()=>{selected=isoDay();showSearch=false;query='';$('.timeline')?.removeAttribute('data-date');$('.month-scroll')?.removeAttribute('data-focus');$('.month-with-agenda,.day-checklist')?.removeAttribute('data-date');await loadData();render()},
 'prev':()=>move(-1),'next':()=>move(1),
 'date':async el=>{const previousMonth=selected.slice(0,7);selected=el.dataset.date;if(previousMonth!==selected.slice(0,7))await loadData();render()},
 'week-date':el=>{selected=el.dataset.date;render()},
 'event':el=>openEvent(el.dataset.id,el.dataset.occ),
 'create':async()=>{await api('calendar','POST',{});await refresh()},
 'invite':async()=>{const result=await api('invite','POST',{});inviteUrl=result.url;render()},
 'copy-invite':async()=>{await navigator.clipboard.writeText(inviteUrl);toast(t('copied'))},
 'return':async()=>{await api('membership','POST',{returning:true});await refresh()},
 'leave':async()=>{if(await confirmDialog(t('leave'),t('leaveHelp'))){await api('membership','POST',{returning:false});await refresh()}},
 'new':()=>newEvent(),
 'edit-event':async()=>{endManuallySet=false;formScope=currentEvent.rrule?await chooseScope():'all';if(!formScope)return;formEvent={...structuredClone(formScope==='all'?(currentEvent.master||currentEvent):currentEvent),advanced:true};page='form';render()},
 'back':async()=>{if(page==='form'&&currentEvent){page='detail';render();return}page='main';await loadData();render()},
 'delete-event':()=>deleteCalendarEvent(currentEvent),
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
async function move(n){await navigateSmoothly({type:'move',direction:n},CalendarNavigation.motion({preview:navigationPreview}))}
function categoryDialog(category){
 const el=document.createElement('div');el.className='modal-backdrop category-backdrop';const c=category||{name:'',color:'#9B77D1',translations:{}};
 el.innerHTML=`<form id="category-form" class="modal category-sheet" role="dialog" aria-modal="true"><div class="modal-header"><button type="button" id="close-category">${t('cancel')}</button><h2>${t(category?'edit':'newCategory')}</h2><button type="submit">${t('save')}</button></div><label>${t('name')}</label><div class="category-edit">${input('name',c.name,'text','required maxlength="100" aria-label="'+t('name')+'"')}${input('colorPicker',c.color,'color','aria-label="'+t('color')+'"')}</div><p></p>${field('color',input('color',c.color,'text','required pattern="#[0-9a-fA-F]{6}"'))}<div class="swatches">${['#9B77D1','#D47AAE','#D77777','#E0A34B','#D0BD55','#55A77B','#4DA5A8','#598DD4','#7778C9','#888888','#333333','#F3B6D4'].map(x=>`<button class="swatch ${x.toLowerCase()===c.color.toLowerCase()?'selected':''}" type="button" aria-pressed="${x.toLowerCase()===c.color.toLowerCase()}" data-color="${x}" data-bg="${x}" aria-label="${x}"></button>`).join('')}</div>${field('translations',input('ru',c.translations?.ru||'','text','placeholder="Русский"'))}${input('en',c.translations?.en||'','text','placeholder="English"')}<div class="color-preview"><div><span class="dot preview-dot" data-bg="${c.color}"></span>${t('light')}</div><div><span class="dot preview-dot" data-bg="${c.color}"></span>${t('dark')}</div></div><p class="privacy">${t('categoryDelete')}</p>${category&&cfg.integrations?.translation==='configured'?'<button type="button" id="translate-category" class="text-button">'+t('retranslateCategory')+'</button>':''}${category?`<button type="button" id="remove-category" class="danger sheet-delete">${t('delete')}</button>`:''}</form>`;
 document.body.append(el);paint();$('input',el).focus();$('#close-category',el).onclick=()=>el.remove();
 const updateColor=value=>{$$('[data-color]',el).forEach(b=>{const active=b.dataset.color.toLowerCase()===value.toLowerCase();b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active))});$$('.preview-dot',el).forEach(d=>d.style.backgroundColor=value)};
 $$('[data-color]',el).forEach(b=>b.onclick=()=>{$('[name=color]',el).value=b.dataset.color;$('[name=colorPicker]',el).value=b.dataset.color;updateColor(b.dataset.color)});
 $('[name=colorPicker]',el).oninput=e=>{$('[name=color]',el).value=e.target.value;updateColor(e.target.value)};
 $('[name=color]',el).oninput=e=>{if(/^#[0-9a-fA-F]{6}$/.test(e.target.value)){$('[name=colorPicker]',el).value=e.target.value;updateColor(e.target.value)}};
 $('#category-form',el).onsubmit=async e=>{e.preventDefault();const d=new FormData(e.target);try{await api('categories'+(category?'/'+category.id:''),category?'PATCH':'POST',{name:d.get('name'),color:d.get('color'),translations:{ru:d.get('ru'),en:d.get('en')}});el.remove();await loadData();render()}catch(err){toast(err.message)}};
 if($('#translate-category',el))$('#translate-category',el).onclick=async()=>{try{await api('categories/'+category.id+'/translate','POST',{});toast(t('translationQueued'));el.remove()}catch(err){toast(err.message)}};
 if(category)$('#remove-category',el).onclick=async()=>{if(await confirmDialog(t('categoryDelete'))){await api('categories/'+category.id,'DELETE');el.remove();await loadData();render()}};
}
const calendarSwipe=CalendarNavigation.mount({
 enabled:()=>Boolean(state?.calendar?.active&&state.calendar.state==='active'&&page==='main'&&!showSearch&&!busy&&!monthLoading&&!document.querySelector('.modal-backdrop')),
 getView:activeNavigation,getItems:touchBarItems,
 label:action=>['view','tab'].includes(action.type)?t(action.view||action.tab):action.type==='limit'?t(activeNavigation()):`${action.direction>0?'←':'→'} ${t(action.direction>0?'next':'back')} · ${t(view)}`,
 startMotion:()=>CalendarNavigation.motion({preview:navigationPreview,haptic:()=>{try{tg?.HapticFeedback?.selectionChanged()}catch{}}}),
 run:async(action,motion)=>{busy=true;try{await navigateSmoothly(action,motion)}finally{busy=false}},
 onError:error=>toast(error.message)
});
const calendarTouch=CalendarTouch.mount({
 enabled:()=>Boolean(state?.calendar?.active&&state.calendar.state==='active'&&tab==='calendar'&&page==='main'&&!showSearch&&!busy&&!monthLoading&&!document.querySelector('.modal-backdrop')),
 getEvent:el=>listedEvent(el),onCreate:newEvent,onMove:moveTimelineEvent,onError:error=>toast(t(error.message)),
 cancelSwipe:()=>calendarSwipe.cancel(),haptic:()=>{try{tg?.HapticFeedback?.impactOccurred('light')}catch{}}
});
$('#app').addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el||busy||calendarSwipe.active()||calendarTouch.active())return;e.stopPropagation();const action=actions[el.dataset.action];if(!action)return;busy=true;try{await action(el)}catch(error){toast(error.message)}finally{busy=false}});
$('#app').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.day')){e.preventDefault();e.target.click()}});
$('#app').addEventListener('submit',async e=>{if(e.target.id==='event-form'){e.preventDefault();if(busy)return;busy=true;e.target.classList.add('busy');try{await saveForm()}finally{busy=false;$('#event-form')?.classList.remove('busy')}}});
$('#app').addEventListener('change',async e=>{const el=e.target;try{
 if(el.name==='touchbar-item'){const items=touchBarItems().filter(id=>id!=='settings'&&id!==el.value);if(el.checked)items.push(el.value);try{await saveTouchBar([...items,'settings'])}catch(error){render();throw error}return}
 if(el.id==='demo-user'){await login(el.value);return}
 if(el.name==='start'){
  const previous={...formEvent};captureForm();
  if(!formEvent.all_day){const times=CalendarTime.moveStart(previous,formEvent.start,endManuallySet);formEvent={...formEvent,...times};$('[name=end]').value=times.end}
  else if(formEvent.end<=formEvent.start){formEvent.end=addDays(formEvent.start,1);$('[name=end]').value=formEvent.end}
  return;
 }
 if(el.name==='end'){endManuallySet=true;captureForm();return}
 if(el.name==='all_day'){captureForm();endManuallySet=false;if(formEvent.all_day){formEvent.start=formEvent.start.slice(0,10);formEvent.end=addDays(formEvent.start,1)}else Object.assign(formEvent,CalendarTime.defaults(formEvent.start.slice(0,10),formEvent.timezone,state.me.default_duration||60));render();return}
 if(el.name==='duration-preset'){
  if(el.value==='custom'){$('#custom-duration-row').hidden=false;$('[name=setting-default_duration]').focus();return}
  state=await api('settings','PATCH',{default_duration:Number(el.value)});render();return;
 }
 if(el.name==='repeat'||el.name.startsWith('repeat-')){captureForm();render();return}
 if(el.name.startsWith('filter-')){filter[el.name.slice(7)]=el.value;await loadData();render();return}
 if(el.name==='event-status'){
  const value=el.value;if(currentEvent.rrule)await api('events/'+currentEvent.id+'/occurrence','POST',{occurrence:currentEvent.occurrence,revision:currentEvent.revision,scope:'one',changes:{status:value}});else await api('events/'+currentEvent.id,'PATCH',{revision:currentEvent.revision,status:value});
  const id=currentEvent.id,key=currentEvent.occurrence;page='main';await loadData();await openEvent(id,key);return;
 }
 if(el.name==='reminder'&&$$('[name=reminder]:checked').length>3){el.checked=false;toast(t('invalid_reminders'));return}
 if(el.name==='default-reminder'){const values=$$('[name=default-reminder]:checked').map(x=>Number(x.value));if(values.length>3){el.checked=false;toast(t('invalid_reminders'));return}await api('settings','PATCH',{default_reminders:values});state.me.default_reminders=values;return}
 if(el.name.startsWith('setting-')){const key=el.name.slice(8);state=await api('settings','PATCH',{[key]:el.type==='checkbox'?el.checked:key==='default_duration'?Number(el.value):el.value});render();return}
 }catch(error){toast(error.message);if(el.type==='checkbox')el.checked=!el.checked}});
let searchTimer;
$('#app').addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{try{const pos=$('#search')?.selectionStart;await loadData();render();$('#search')?.focus();$('#search')?.setSelectionRange(pos,pos)}catch(err){toast(err.message)}},250)}});
async function login(demoUser='1'){
 const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg.demo?{demo_user:demoUser}:{init_data:tg?.initData||''})});
 const result=await response.json();if(!response.ok)throw new Error(t(result.error));token=result.token;state=result.state;
 selected=isoDay();view='day';monthWindow=[];filter={owner:'',category:'',status:''};query='';page='main';tab='calendar';
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
 await loadData();render();await openLinkedEvent();
}
async function boot(){
 try{tg?.ready();tg?.expand();cfg=await(await fetch('/api/config')).json();if(!cfg.demo&&!tg?.initData){$('#app').innerHTML=`<div class="splash"><div class="brand-mark">oc</div><h1>Our Calendar</h1><p>${t('telegramOnly')}</p></div>`;return}await login()}
 catch(error){$('#app').innerHTML=`<main class="shell"><div class="card"><h1>Our Calendar</h1><p class="error">${esc(error.message)}</p><button id="retry">${t('retry')}</button></div></main>`;$('#retry').onclick=boot}
}
matchMedia('(prefers-color-scheme:dark)').addEventListener('change',applyTheme);
window.addEventListener('focus',async()=>{if(token&&!busy&&!calendarSwipe.active()&&!calendarTouch.active()){try{if(!await openLinkedEvent()&&page==='main')await refresh()}catch{}}});
boot();

setInterval(async()=>{
 if(document.hidden||busy||monthLoading||calendarSwipe.active()||calendarTouch.active()||!token||document.querySelector('.modal-backdrop'))return;
 try{
  const next=await api('state');if(calendarSwipe.active()||calendarTouch.active()||monthLoading)return;
  if(!next.calendar?.active||next.calendar.state!=='active'){state=next;render();return}
  state=next;
  if(page==='main'){
   if(document.activeElement?.matches('input,textarea,select'))return;
   const scroll=window.scrollY,timelineScroll=$('.timeline')?.scrollTop;
   await loadData();if(calendarSwipe.active()||calendarTouch.active()||monthLoading)return;render();
   if(timelineScroll!==undefined&&$('.timeline'))$('.timeline').scrollTop=timelineScroll;
   window.scrollTo(0,scroll);
  }else if(page==='detail'&&['pending','failed'].includes(currentEvent?.translation_status?.state))await openEvent(currentEvent.id,currentEvent.occurrence);
 }catch(_){}
},15000);
