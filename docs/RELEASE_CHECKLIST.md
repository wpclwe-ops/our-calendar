# Приёмка 0.3.0

## Автоматические и локальные проверки

- [x] Подпись/свежесть Telegram, запрет production demo, IDOR, права ушедшего участника.
- [x] Гонка приглашения, неизменяемость пары, защита конкурентных правок.
- [x] Поиск изменений экземпляра, статусы/категории/принадлежность, moved exception, одна серия на результат.
- [x] Визуальный редактор повторений: недельные дни, второй вторник, последний день недели, UNTIL и COUNT, сохранение особого правила.
- [x] Напоминания каждого, «Весь день»/зоны, статус одного экземпляра, перенос и отсутствие догоняющей отправки.
- [x] Перевод серии и исключений, ручные версии и конкурентная правка, пустые переводы категории.
- [x] Подписанный ZIP: чужой архив, повреждение, diff, revision, одноразовый предпросмотр, восстановление из корзины.
- [x] Полное удаление, отмена, очистка и возврат исходной пары с двумя согласиями; напоминания выключены.
- [x] Служебный encrypted snapshot: roundtrip БД/ключей, проверка старого ZIP, неверный ключ, повреждение, запрет перезаписи, retry и отсутствие секретов в ошибках.
- [x] Журнал удалений обязателен при offline restore; старый snapshot не возвращает окончательно удалённый календарь.
- [x] Health обнаруживает остановку обработчика и устаревшую копию; перевод не блокирует напоминания.

## Проверки размещения после обновления

- [x] Последний commit в GitHub Actions — success.
- [x] Railway deployment последнего commit — success, одна реплика, `/data` сохранён.
- [x] `/health`: ready=true, bot_setup=ready, translation.state=ready.
- [x] Первая encrypted копия сохранена, прочитана и пробно восстановлена: backup.state=ready.
- [x] Внешняя HTTP-проверка проходит; monitor.yml опубликован в main с расписанием каждые 15 минут. Фактический первый scheduled run отслеживается отдельно.

## Реальные устройства и аккаунты

- [ ] Оба получают уведомление о начале/заранее при закрытом Mini App.
- [ ] RU/EN и ручные переводы правильно видны на двух телефонах.
- [ ] iOS/Android/desktop Telegram WebView: формы, клавиатура, прокрутка, фокус, темы и отсутствие обрезанных углов.
- [ ] ICS открыт в настоящем Apple/Google Calendar; даты и повторения сохранены.
- [ ] Процедуры полного удаления/ZIP проверены двумя реальными аккаунтами на отдельном тестовом календаре.
- [ ] Оператор сохранил дополнительную защищённую копию ключа вне Railway и оформил политику конфиденциальности перед публичным запуском.

Реальные тесты нельзя помечать выполненными на основании подставного Telegram transport. Полная реализация исходного ТЗ дополнительно требует Google/iCloud и внешней синхронизации.

## Опубликовано 16 октября 2026

PR #5 слит с явного разрешения пользователя. Release commit: `c135ab0aeaa58400515b2a231edbb84823d6cbd6`; Railway deployment `a732b262-7cbe-46c0-9268-dc894546c929` — SUCCESS.

`release_checkpoint` — ready, создан 16:00:24 UTC **до запуска приложения**. Первая ежедневная encrypted копия — ready, проверена 16:00:25 UTC, хранение 7 дней. Перевод и бот — ready; один работающий экземпляр приложения и один перевода, ошибок инфраструктуры не обнаружено. Проверены 401 для приватных API/ZIP, запрет demo-входа и соответствие опубликованного recurrence.js проверенному файлу.

Предыдущий deployment `45524bf2-64a6-4c8f-8955-9f92de41e2a7` и ветка `rollback/pre-0.3.0-20261016` сохранены как точка возврата кода. Проверка получения уведомлений телефоном не подменяется серверным состоянием ready.


## 0.7.0 — 18 октября 2026

Дополнительные виды недели: прежний список, 3-дневный и 7-дневный таймлайны. Не изменять личный Touch Bar при обновлении. Существующим профилям оставить agenda; события не мигрируются. Версии package/API/health и URL CSS/JS: 0.7.0.
Перед публикацией: 145 Python, 26 Node, compileall, синтаксис JS и шесть браузерных сценариев на синтетических БД. После публикации отдельно подтвердить GitHub Checks, Railway SUCCESS для нового commit, /health 0.7.0, одну реплику и прежний /data. Существующий release checkpoint обязателен. Приёмка в Telegram WebKit на телефоне остаётся пользовательской; этапы Google/iCloud не затронуты.


## 0.7.1 — рабочее пространство таймлайнов, 18 октября 2026

Боковые поля недельных таймлайнов 6 px, шкала времени 40 px; сокращён промежуток после диапазона дат, инструменты подняты на 6 px. Таймлайны дня и недели доходят до нижнего края экрана под плавающими кнопками. Нижний запас прокрутки сохранён для поздних событий. Проверка геометрии, прозрачности/доступности области между кнопками и подъёма события 23:30 добавлена в существующий браузерный сценарий недели для обеих тем, RU/EN и 320/390/430 px. Список и месячные виды сохраняют прежнюю высоту.


## 0.7.2 — оба вида месяца без нижней полосы

Применить полную высоту рабочего календаря и нижний запас прокрутки также к month-with-agenda/month-scroll. Проверить оба вида в light/dark на 320/390/430 px: календарь до нижнего края, касания между плавающими кнопками проходят к календарю, последний элемент поднимается выше кнопок, общий scrollport/якорь/подгрузка/Сегодня сохранены. Версия API/health/package и URL CSS/JS — 0.7.2.

## Google import-only 0.8.0

- Preserve the current one-replica SQLite volume and release checkpoint.
- Run Python, JS and all browser CI checks, including Google synthetic acceptance.
- Google settings remain explicitly unconfigured until all OAuth variables exist.
- Set the exact callback URL and read-only scopes from `docs/GOOGLE_IMPORT.md`.
- Keep the independent credential key outside Git/DB and preserve it for recovery.
- Do not claim live Google acceptance before testing actual accounts and devices.
- Rolling back application code is additive-schema compatible; restore data only
  through the existing verified operator recovery procedures if required.

## Smart Events 0.9.1 activation

- [ ] Established encrypted operator recovery checkpoint before a production upgrade.
- [ ] Verify separate OpenAI API billing/model access; set the key only on the backend.
- [ ] Review current model tariffs and the informational monthly reservation ledger (no application spending cap since 0.10.0).
- [ ] Participant consent/source scope tested; old records require explicit selection.
- [ ] Review real model quality. Personal mode defaults to suggestions; automatic assignment needs both participants' explicit choice. The operator can pause it with SMART_AUTO_CATEGORIES_ENABLED=false.
- [ ] Verify actual Telegram/iPhone WebKit, live provider updates and reminders.
- [ ] Restore ZIP v1/v2; full restore leaves API consent and reminders disabled.

A draft PR with synthetic checks does not mark any of these production acceptance
items complete. Rollback to 0.8.4 requires its compatible recovery checkpoint,
not running its old validator against new smart event JSON.


## Settings 0.10.0

Before merge: full Python/Node suite, compileall, JS syntax, mobile settings/profile/default-reminder acceptance and existing calendar/import regression scenarios. Confirm personal name/gender and decision-memory ownership, shared-profile revision conflicts, v1/v2 archive compatibility and unchanged existing-event reminder schedules. No live provider writes or notification smoke messages.

After merge: observe GitHub Checks, Railway SUCCESS for the exact main commit, /health version 0.10.0 and ready release checkpoint; retain one replica and /data. A successful deployment does not establish real iPhone WebKit, OpenAI quality/billing or end-to-end Telegram delivery acceptance.
