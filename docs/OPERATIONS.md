# Эксплуатация — Production Calendar 2026

## 1. Назначение

Этот документ описывает day-2 эксплуатацию продакшн-календаря:
- health checks;
- рестарты;
- логи;
- проверки nginx;
- особенности SQLite;
- безопасный порядок изменений;
- первичную диагностику инцидентов.

Текущая продакшн-точка:
- каталог репозитория: `/root/production-calendar`
- PM2-процесс: `production-calendar`
- локальный порт приложения: `127.0.0.1:3000`
- публичный URL: `https://calendar.agenticengineer.ru`

---

## 2. Карта сервиса

### Приложение
- Next.js-приложение, запущенное через PM2
- command path: `/usr/bin/npm`
- args: `start`
- working directory: `/root/production-calendar`

### Reverse proxy
- nginx site file: `/etc/nginx/sites-available/calendar`
- upstream: `http://127.0.0.1:3000`

### Данные
- путь к SQLite задаётся через `DATABASE_PATH`
- fallback-путь в коде: `./data/calendar.db`

---

## 3. Быстрый health check

### PM2

```bash
pm2 describe production-calendar
pm2 logs production-calendar --lines 30 --nostream
```

Ищем:
- `status: online`
- отсутствие restart loop
- отсутствие свежих fatal errors

### Локальный HTTP

```bash
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1:3000/login
```

Ожидаемо:
- `/` может редиректить;
- `/login` отвечает корректно.

### Публичный HTTPS

```bash
curl -I https://calendar.agenticengineer.ru/login
```

Ожидаемо:
- нет `502`;
- нет проблем с сертификатом;
- login page отвечает.

### nginx

```bash
nginx -t
systemctl status nginx --no-pager
```

### Ресурсы

```bash
free -h
df -h /
```

### SSL

```bash
certbot certificates | sed -n '/calendar\.agenticengineer\.ru/,+6p'
```

---

## 4. Основные операционные команды

### Рестарт приложения

```bash
pm2 restart production-calendar
```

### Остановка приложения

```bash
pm2 stop production-calendar
```

### Старт уже зарегистрированного PM2 entry

```bash
pm2 start production-calendar
```

### Пересборка и рестарт после изменения кода

```bash
cd /root/production-calendar
npm install
npm run build
pm2 restart production-calendar
```

### Сохранение состояния PM2

```bash
pm2 save
```

---

## 5. Логи

### PM2

```bash
pm2 logs production-calendar --lines 100 --nostream
```

Текущие пути логов:
- out log: `/root/.pm2/logs/production-calendar-out-0.log`
- error log: `/root/.pm2/logs/production-calendar-error-0.log`

### nginx

Обычно полезно смотреть:

```bash
tail -n 100 /var/log/nginx/access.log
tail -n 100 /var/log/nginx/error.log
```

Это нужно, когда:
- публичный сайт не работает, но локальный порт жив;
- есть подозрение на proxy / SSL / routing проблему;
- нужно проверить реальные HTTP-запросы.

---

## 6. Особенности SQLite

Приложение использует SQLite с:
- WAL mode
- foreign keys

Нормальные файлы рядом с БД:
- `calendar.db`
- `calendar.db-wal`
- `calendar.db-shm`

Наличие `-wal` / `-shm` само по себе не является проблемой.
Это нормальное поведение для WAL-режима.

### Read-only инспекция БД

```bash
python3 - <<'PY'
import sqlite3
conn=sqlite3.connect('file:/root/production-calendar/data/calendar.db?mode=ro', uri=True)
cur=conn.cursor()
for t in ['users','settings','overtime','absences']:
    cur.execute(f'SELECT COUNT(*) FROM {t}')
    print(t, cur.fetchone()[0])
PY
```

### Рекомендация по бэкапу

Перед рискованными изменениями в persistence/schema сделать копию БД:

```bash
cp /root/production-calendar/data/calendar.db /root/production-calendar/data/calendar.db.bak-$(date +%F-%H%M%S)
```

Если WAL активно используется и нужна строгая консистентность, лучше делать SQLite-aware backup или сначала остановить запись.

---

## 7. Безопасный порядок изменений

Рекомендуемая последовательность:

1. Проверить текущее здоровье сервиса.
2. Посмотреть git diff / целевой коммит.
3. При необходимости сделать бэкап данных.
4. Подтянуть или применить изменения кода.
5. Выполнить `npm install`, если менялись зависимости.
6. Выполнить `npm run build`.
7. Перезапустить PM2-процесс.
8. Проверить локальный HTTP.
9. Проверить публичный HTTPS.
10. Проверить логи после рестарта.

Практический шаблон:

```bash
cd /root/production-calendar
git status --short --branch
git pull --ff-only
npm install
npm run build
pm2 restart production-calendar
pm2 logs production-calendar --lines 50 --nostream
curl -I http://127.0.0.1:3000/login
curl -I https://calendar.agenticengineer.ru/login
```

---

## 8. Первичная диагностика инцидентов

### Симптом: сайт отдаёт 502

Проверить:

```bash
pm2 describe production-calendar
pm2 logs production-calendar --lines 100 --nostream
curl -I http://127.0.0.1:3000/login
systemctl status nginx --no-pager
```

Интерпретация:
- локальный порт не отвечает + PM2 unhealthy → проблема в приложении;
- локальный порт жив, а снаружи 502 → проблема в nginx / proxy layer.

### Симптом: login page работает, но dashboard/API падают

Проверить:

```bash
pm2 logs production-calendar --lines 100 --nostream
```

Фокус:
- auth misconfiguration;
- missing env vars;
- DB path / permissions;
- runtime exceptions в API routes.

### Симптом: не работает Google auth

Проверить:
- наличие и корректность `.env.local`;
- настройки Google OAuth под текущий домен;
- соответствие `AUTH_URL` / trusted host текущему адресу приложения.

### Симптом: приложение запускается, но данные «пропали»

Проверить:
- `DATABASE_PATH`;
- не смотрит ли приложение в другой SQLite-файл;
- существование файла БД и права на него.

### Симптом: UI показывает ошибку сохранения

UI умеет показывать баннер ошибки сохранения, если API-запрос не удался.

Проверить:

```bash
pm2 logs production-calendar --lines 100 --nostream
curl -I http://127.0.0.1:3000/login
```

Дальше смотреть по слоям:
- API
- auth
- DB
- локальная доступность приложения

---

## 9. Операционные ограничения

1. Бизнес-логика жёстко привязана к **2026 году**.
2. Праздники и сокращённые дни зашиты в код.
3. Основная payroll-логика находится в `app/dashboard/client.js`.
4. В репозитории нет набора автотестов.
5. В репозитории нет ecosystem-файла PM2.

---

## 10. Обязательная проверка после любого рестарта

```bash
pm2 describe production-calendar
pm2 logs production-calendar --lines 50 --nostream
curl -I http://127.0.0.1:3000/login
curl -I https://calendar.agenticengineer.ru/login
nginx -t
```

Минимальные критерии успеха:
- PM2 `online`
- локальный `/login` отвечает
- публичный `/login` отвечает
- nginx config valid
- в PM2-логах нет fatal errors

---

## 11. Текущее зафиксированное продакшн-состояние

Observed state на момент документирования:
- repository path: `/root/production-calendar`
- public domain: `calendar.agenticengineer.ru`
- nginx upstream: `127.0.0.1:3000`
- PM2 process name: `production-calendar`
- PM2 execution mode: `cluster_mode`
- процесс запускается через `npm start`
- git remote: `origin -> arthotelnova-svg/production-calendar-original.git`
