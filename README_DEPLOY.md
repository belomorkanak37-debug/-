# Чё позырить? — публичная PWA-ссылка

Этот комплект нужен, чтобы выложить приложение в интернет и отправить ссылку на iPhone, который не рядом.

## Что внутри

- `www/` — само приложение: HTML, manifest, service worker, иконки.
- `server/index.mjs` — Node.js сервер: отдаёт приложение и подбирает тайтлы.
- `package.json` — команды запуска.
- `render.yaml` — заготовка для Render Blueprint.
- `Dockerfile` — запасной вариант для Docker-хостинга.
- `.env.example` — пример переменной окружения.

## Важно про ключ

Ключ нельзя хранить в `www/index.html` и нельзя коммитить в публичный GitHub.
На хостинге добавь переменную окружения:

```env
KINOPOISK_API_KEY=твой_ключ
```

## Быстрый локальный запуск

```bash
npm install
KINOPOISK_API_KEY="твой_ключ" npm start
```

Windows PowerShell:

```powershell
$env:KINOPOISK_API_KEY="твой_ключ"
npm start
```

Проверка:

```text
http://localhost:4177/
http://localhost:4177/api/ping
```

## Публичный запуск через Render

1. Создай новый репозиторий на GitHub.
2. Загрузи в него содержимое этой папки.
3. На Render создай `New Web Service` и подключи GitHub-репозиторий.
4. Настройки:
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
5. В Environment Variables добавь:
   - `KINOPOISK_API_KEY` = твой ключ
6. Нажми Deploy.
7. После деплоя открой выданную ссылку вида:

```text
https://che-pozyrit.onrender.com
```

## Публичный запуск через Railway

1. Создай проект из GitHub-репозитория.
2. В Variables добавь:
   - `KINOPOISK_API_KEY` = твой ключ
3. Railway сам запустит `npm start`.
4. В Settings / Networking сгенерируй публичный домен.

## Как установить на удалённый iPhone

1. Отправь человеку публичную HTTPS-ссылку.
2. Он открывает её в Safari.
3. Нажимает `Поделиться`.
4. Выбирает `На экран «Домой»`.
5. На iPhone появится иконка приложения.

## Если что-то не работает

- `/api/ping` должен вернуть `ok: true`.
- Если `/api/ping` падает — проверь `KINOPOISK_API_KEY` на хостинге.
- Если приложение открывается, но подбор не работает — смотри логи сервера на Render/Railway.
- Если iPhone не предлагает добавить на экран — открой ссылку именно в Safari, не во встроенном браузере Telegram/Instagram.
