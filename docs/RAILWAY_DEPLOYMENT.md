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

SESSION_SECRET и WEBHOOK_SECRET созданы случайно и хранятся только в переменных Railway. Их значения в репозитории отсутствуют. BOT_TOKEN и BOT_USERNAME пока должен добавить владелец.

## Что нужно владельцу

1. Открыть Dashboard → сервис `our-calendar` → **Variables**.
2. Добавить **BOT_TOKEN** — токен нового бота из BotFather.
3. Добавить **BOT_USERNAME** — его username без `@`.
4. Применить изменения. Остальные служебные переменные уже настроены.
5. Дождаться перезапуска. `/health` должен показать `ready=true`, затем `bot_setup=ready` и свежий `worker_heartbeat`.
6. В BotFather включить основную Mini App и указать публичный адрес сервиса. Каждый участник должен нажать Start в чате с ботом.

До заполнения переменных сервер показывает только закрытую страницу настройки. `SETUP_MODE=true` не включает демоданные и не обходит Telegram authentication. После заполнения конфигурации обычное приложение выбирается автоматически. Сервис настраивает webhook/menu после проверки соответствия token и username.

Legacy Config as Code (`railway.json`) не поддерживается для новых сервисов Railway. Параметры выше заданы через Railway API, файл из репозитория удалён. Для будущей декларативной конфигурации можно импортировать существующие ресурсы через Railway IaC без включения значений секретов в source.
