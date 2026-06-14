# Production Calendar 2026

Production Calendar 2026 — продакшн-веб-приложение для персонального расчёта зарплаты и переработок на базе Next.js, Google OAuth и SQLite.

## Возможности

- вход через Google;
- хранение персональных настроек расчёта;
- учёт переработок по дням;
- учёт дней `не работал`;
- расчёт итогов по месяцу и по году;
- разбиение выплат на `аванс` и `перерасчёт`;
- экспорт в Excel и JPEG.

## Документация

- Техническая документация: `docs/TECHNICAL_DOCUMENTATION.md`
- Деплой: `docs/DEPLOYMENT.md`
- Эксплуатация: `docs/OPERATIONS.md`

## Стек

- Next.js 14
- React 18
- NextAuth v5 beta
- Google OAuth
- SQLite (`better-sqlite3`)
- `xlsx`
- `html2canvas`

## Переменные окружения

Приложение ожидает `.env.local` со следующими переменными:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_SECRET`
- `AUTH_URL`
- `AUTH_TRUST_HOST`
- `DATABASE_PATH`

## Локальный запуск

```bash
npm install
npm run build
npm start
```

По умолчанию `npm start` запускает:

```bash
next start -p 3000
```

## Продакшн-схема

Текущая продакшн-конфигурация:
- каталог приложения: `/root/production-calendar`
- имя PM2-процесса: `production-calendar`
- локальный порт приложения: `127.0.0.1:3000`
- публичный домен: `https://calendar.agenticengineer.ru`
- nginx проксирует HTTPS-трафик на локальный порт приложения

Текущий прод-процесс PM2 запускается из каталога репозитория через `npm start`.
В репозитории сейчас **нет** `pm2.config.js` / ecosystem-файла.

Пример ручного старта через PM2:

```bash
cd /root/production-calendar
NODE_ENV=production pm2 start npm --name production-calendar -- start
```

## Репозиторий

Git remote:
- `origin -> arthotelnova-svg/production-calendar-original.git`
