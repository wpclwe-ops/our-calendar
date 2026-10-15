# Размещение Our Calendar

Проект Railway: `our-calendar`, среда `production`. Репозиторий: `wpclwe-ops/our-calendar`, ветка `main`.

- Project ID: `a1ef8c5a-c529-40f6-88b1-50d4ebbaa1d6`
- Environment ID: `a628191b-a89a-41b4-aad0-ec48b97383ff`
- Service ID: `8c7c1a2c-8a80-4c1d-8911-641a43bdea81`
- Domain: https://our-calendar-production-ffcb.up.railway.app
- Dashboard: https://railway.com/project/a1ef8c5a-c529-40f6-88b1-50d4ebbaa1d6/service/8c7c1a2c-8a80-4c1d-8911-641a43bdea81?environmentId=a628191b-a89a-41b4-aad0-ec48b97383ff

| Параметр | Значение |
| --- | --- |
| Builder | Dockerfile в корне |
| Start command | `python -m app` |
| Healthcheck | `/health`, timeout 60 s |
| Port | 8000 |
| Region | europe-west4 |
| Replicas | 1 |
| Sleep | Выключен |
| Resource limit | 1 vCPU, 0.5 GB memory |
| Persistent volume | calendar-data, 500 MB, mount `/data` |
| Database | `/data/calendar.sqlite3` |
| Signing private key | `/data/archive-key.pem` |
| Public key registry | `/data/archive-public-keys.json` |

SESSION_SECRET и WEBHOOK_SECRET созданы случайно и хранятся только в переменных Railway. BOT_TOKEN и BOT_USERNAME добавлены владельцем. Значения секретов в репозитории отсутствуют.

## Проверенное состояние

Deployment `a431c0e4-627f-45b5-b707-570287589e7c`: **SUCCESS**. Одна running replica, ошибок нет. Проверка 2026-10-15 22:59 UTC: HTTPS `/health` возвращает `ok=true`, `ready=true`, `demo=false`, `bot_setup=ready` и свежий `worker_heartbeat`. Имя бота подтверждено через Telegram getMe: [@ourcalendar_bot](https://t.me/ourcalendar_bot). Telegram принял регистрацию webhook, меню и команд.

Открытие Mini App двумя настоящими участниками и доставка напоминаний при закрытом приложении ещё не проверены. Google, iCloud и сервис перевода не подключены; состояние реализации описано в IMPLEMENTATION.md.

## Что нужно владельцу

1. В BotFather выбрать `/mybots` → `@ourcalendar_bot` → Bot Settings → Configure Mini App и включить основную Mini App с URL `https://our-calendar-production-ffcb.up.railway.app`.
2. Открыть https://t.me/ourcalendar_bot, нажать Start, затем кнопку календаря. Каждый участник должен нажать Start в чате с ботом.
3. Пройти docs/RELEASE_CHECKLIST.md на двух настоящих аккаунтах, включая напоминание при закрытом Mini App.

До заполнения переменных сервер показывает только закрытую страницу настройки. `SETUP_MODE=true` не включает демоданные и не обходит Telegram authentication. После заполнения конфигурации обычное приложение выбирается автоматически. Сервис настраивает webhook/menu после проверки соответствия token и username.

Legacy Config as Code (`railway.json`) не поддерживается для новых сервисов Railway. Параметры выше заданы через Railway API, файл из репозитория удалён. Для будущей декларативной конфигурации можно импортировать существующие ресурсы через Railway IaC без включения значений секретов в source.
