# Деплой — Production Calendar 2026

## 1. Назначение

Этот документ описывает актуальный способ деплоя `production-calendar-2026` в том виде, в котором приложение сейчас работает в продакшне.

Характеристики приложения:
- Next.js-приложение;
- Google OAuth через NextAuth;
- SQLite как локальное хранилище;
- PM2 для управления процессом;
- nginx как reverse proxy;
- HTTPS через Certbot.

Текущий продакшн-таргет:
- домен: `calendar.agenticengineer.ru`
- локальный upstream: `127.0.0.1:3000`
- каталог репозитория: `/root/production-calendar`

---

## 2. Предварительные требования

На сервере должны быть установлены:
- Node.js
- npm
- PM2
- nginx
- валидные Google OAuth credentials
- доступный для записи путь под SQLite

Рекомендуется:
- Certbot для выпуска и продления сертификатов
- systemd-автозапуск PM2 (`pm2-root.service` или эквивалент)

---

## 3. Переменные окружения

В корне репозитория должен быть файл `.env.local` со значениями:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_SECRET`
- `AUTH_URL`
- `AUTH_TRUST_HOST`
- `DATABASE_PATH`

Пример формы:

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_SECRET=...
AUTH_URL=https://calendar.agenticengineer.ru
AUTH_TRUST_HOST=true
DATABASE_PATH=/root/production-calendar/data/calendar.db
```

Примечания:
- `DATABASE_PATH` может быть относительным или абсолютным;
- каталог для БД приложение создаёт само, если он отсутствует;
- `.env.local` намеренно исключён из Git и не должен коммититься.

---

## 4. Установка зависимостей

```bash
cd /root/production-calendar
npm install
```

---

## 5. Сборка приложения

```bash
cd /root/production-calendar
npm run build
```

Ключевые scripts из `package.json`:

```json
{
  "scripts": {
    "build": "next build",
    "start": "next start -p 3000"
  }
}
```

---

## 6. Запуск через PM2

В текущем репозитории **нет** `pm2.config.js` / ecosystem-файла.
Продакшн-процесс запускается напрямую через `npm start`.

### Первый старт

```bash
cd /root/production-calendar
NODE_ENV=production pm2 start npm --name production-calendar -- start
```

### Сохранение списка процессов PM2

```bash
pm2 save
```

### Если нужен автозапуск PM2 после ребута

```bash
pm2 startup
pm2 save
```

Если `pm2 startup` выведет дополнительную bootstrap-команду — выполнить именно её.

---

## 7. Настройка nginx

Текущая рабочая схема nginx:

```nginx
server {
    server_name calendar.agenticengineer.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/calendar.agenticengineer.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calendar.agenticengineer.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
```

HTTP перенаправляется на HTTPS отдельным server block.

### Проверка конфига nginx

```bash
nginx -t
```

### Перезагрузка nginx

```bash
systemctl reload nginx
```

---

## 8. TLS / сертификаты

Для текущего домена сертификаты обслуживаются Certbot.

Полезные команды:

```bash
certbot certificates
systemctl status nginx --no-pager
```

Если домен новый:
1. сначала настроить DNS;
2. затем выпустить сертификат через Certbot;
3. после этого проверить HTTPS-маршрут до приложения.

---

## 9. Проверка после деплоя

После сборки и запуска нужно проверить каждый слой.

### 9.1. PM2-процесс

```bash
pm2 describe production-calendar
pm2 logs production-calendar --lines 50 --nostream
```

Ожидаемое состояние:
- процесс `online`
- рабочий каталог `/root/production-calendar`
- script path `/usr/bin/npm`
- script args `start`

### 9.2. Локальный upstream

```bash
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1:3000/login
```

Ожидаемое состояние:
- приложение отвечает локально;
- `/` может редиректить на `/login`.

### 9.3. Публичный HTTPS

```bash
curl -I https://calendar.agenticengineer.ru/login
```

Ожидаемое состояние:
- страница логина отвечает без `502`;
- HTTPS-цепочка рабочая.

### 9.4. Аутентификация

Ручная проверка:
- открыть login page;
- нажать `Войти через Google`;
- убедиться, что после успешной авторизации пользователь попадает в `/dashboard`.

### 9.5. Создание БД

Если база ещё не существует, первый успешный вход должен создать:
- запись пользователя;
- дефолтные настройки пользователя.

В каталоге SQLite обычно появятся:
- `calendar.db`
- `calendar.db-wal`
- `calendar.db-shm`

---

## 10. Обновление / редеплой

Рекомендуемая последовательность редеплоя:

```bash
cd /root/production-calendar
git pull --ff-only
npm install
npm run build
pm2 restart production-calendar
pm2 save
```

После этого проверить:

```bash
pm2 logs production-calendar --lines 50 --nostream
curl -I http://127.0.0.1:3000/login
curl -I https://calendar.agenticengineer.ru/login
```

---

## 11. Откат

### Git-откат

```bash
cd /root/production-calendar
git log --oneline -n 10
git checkout <known-good-commit>
npm install
npm run build
pm2 restart production-calendar
```

Если нужен чистый branch workflow, предпочтительнее делать `revert`-коммит вместо долгой работы в detached HEAD.

### Замечание по БД

Приложение использует SQLite. Откат кода безопасен только если схема БД совместима.
Если в будущем появятся миграции, rollback по БД должен планироваться отдельно.

---

## 12. Важные ограничения деплоя

1. Приложение жёстко привязано к **2026 году**.
2. В репозитории сейчас нет ecosystem-файла PM2.
3. `.env.local` и SQLite-файлы не должны попадать в Git.
4. Google OAuth должен быть настроен под реальный прод-домен.
5. Приложению нужен путь для записи SQLite-файлов.

---

## 13. Текущее продакшн-состояние (reference)

Зафиксированное состояние на момент документирования:
- имя PM2-процесса: `production-calendar`
- PM2 mode: `cluster_mode`
- команда приложения: `/usr/bin/npm start`
- рабочий каталог: `/root/production-calendar`
- порт приложения: `3000`
- nginx site: `/etc/nginx/sites-available/calendar`
- публичный домен: `calendar.agenticengineer.ru`
