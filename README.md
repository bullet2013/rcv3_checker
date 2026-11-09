# Проверка score Google reCAPTCHA v3 на GitHub Pages + Cloudflare Worker

Готовая переработка диагностической страницы из PHP в бесплатную архитектуру:

**GitHub Pages** (HTML и JS) → **Cloudflare Worker** (секретный ключ, обращение к Google) → **Google reCAPTCHA v3 SiteVerify** (score, action, hostname).

**ВАЖНО:** в исходном коде был указан реальный на вид `SECRET_KEY`. Считайте его скомпрометированным: перевыпустите ключи, прежде чем разворачивать проект. Никогда не добавляйте секрет в репозиторий, HTML или JavaScript браузера.

## Что входит

- `index.html` — страница GitHub Pages: исходный тёмный стиль, кнопка, полный JSON-ответ, score, сбор сведений о браузере и счётчиков активности.
- `worker.js` — код отдельного Cloudflare Worker: проверка через Google и сверка `action`/`hostname`.
- `.nojekyll` — отключает ненужную обработку Jekyll на GitHub Pages.

## Шаг 1. Ключи Google

1. Откройте https://www.google.com/recaptcha/admin
2. Создайте **reCAPTCHA v3 (score-based)** пару ключей, либо перевыпустите скомпрометированный ключ.
3. В список разрешённых доменов добавьте **bullet2013.github.io**. **Не** добавляйте `/repo`, `https://` и порт.
4. Сохраните Site key и Secret key отдельно. Secret key нельзя публиковать.
5. **Не отключайте проверку доменов** без необходимости. Worker в любом случае независимо сверяет `hostname` из ответа Google.

## Шаг 2. Cloudflare Worker (без терминала)

1. Зарегистрируйтесь/войдите в https://dash.cloudflare.com/
2. Откройте **Workers & Pages → Create application → Create Worker** (названия кнопок могут немного меняться).
3. Создайте Worker, затем откройте **Edit code**, замените код содержимым файла `worker.js`.
4. В файле `worker.js` уже настроены параметры:

   ```js
   const ALLOWED_ORIGIN = 'https://bullet2013.github.io';
   const EXPECTED_HOSTNAME = 'bullet2013.github.io';
   ```

   Например, для страницы `https://alice.github.io/recaptcha-check/` значения будут `https://alice.github.io` и `alice.github.io`.
5. Нажмите **Deploy / Save and deploy**.
6. Зайдите в **Worker → Settings → Variables and Secrets → Add**. Выберите **Secret**, имя `RECAPTCHA_SECRET_KEY`, значение — ваш **новый** Google Secret key, сохраните через **Deploy**.
7. Скопируйте URL Worker: например, `https://recaptcha-check.username.workers.dev` (это пример, реальный адрес Cloudflare выдаст вам).
8. Можно открыть URL Worker в браузере: на GET он покажет `"status": "ready"`. Это только проверка работы Worker, не проверка score.

## Шаг 3. GitHub Pages

1. Откройте `index.html` и найдите строки с `SITE_KEY` и `WORKER_URL` в начале JavaScript.
2. Замените:

   ```js
   const SITE_KEY = 'PASTE_NEW_RECAPTCHA_V3_SITE_KEY_HERE';
   const WORKER_URL = 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev';
   ```

   на новый Site key и фактический адрес Worker. URL должен быть строго с `https://`, без пути и без завершающего `/`.
3. Публичный репозиторий уже создан: `bullet2013/rcv3_checker`.
4. Файлы **`index.html`**, **`.nojekyll`**, `README.md` и `worker.js` уже загружены в корень репозитория, секретный ключ не публикуется.
5. Перейдите в **Settings → Pages → Build and deployment → Deploy from a branch → main → /(root) → Save**.
6. Откройте URL `https://bullet2013.github.io/rcv3_checker/` и нажмите **Проверить reCAPTCHA**.

## Что увидите

- `summary.score` — реальная оценка Google от 0.0 до 1.0, если квота не превышена.
- `summary.action_matches` — `true`, когда Google вернул action `login`.
- `summary.hostname_matches` — `true`, когда hostname из Google точно совпал с ожидаемым.
- `summary.above_example_threshold_0_5` — информационная оценка порога `0.5`.
- `received_by_worker.client_data` и `activity` — собранные JS сведения о браузере и действиях.
- `google_response` — декодированный ответ Google.

`ok` отражает успешную валидацию токена, action и hostname и наличие score; не является классификацией "человек/бот". В том числе возможно `ok: true` и `score: 0.1`.

## Типичные ошибки

- **`origin_not_allowed` / CORS** — проверьте `ALLOWED_ORIGIN` в Worker. Для `https://alice.github.io/myrepo` origin — `https://alice.github.io`, путь `/myrepo` туда не входит. После правки повторно разверните Worker.
- **`Invalid domain for site key`** — в reCAPTCHA Admin добавьте фактический hostname и проверьте, что ключ типа v3.
- **`invalid-input-secret`** — новый Secret key в Cloudflare не соответствует Site key или введён неверно.
- **`timeout-or-duplicate`** — токен уже использован или старше двух минут. Нажмите кнопку снова, чтобы получить новый токен.
- **`secret_not_configured`** — добавьте `RECAPTCHA_SECRET_KEY` как Secret, а не в HTML.
- **`hostname_matches: false`** — разрешённый hostname Worker не совпадает с реальным доменом страницы.
- **`over_free_quota: true`** — Google может возвращать фиктивный `0.9` при превышении квоты; Worker не принимает этот score как настоящий.
- **Нет `score`** — убедитесь, что ключ относится к reCAPTCHA v3, а Google вернул `success: true`.

## Безопасность и ограничения

- `SECRET_KEY` остаётся только в Cloudflare Secret. **Не вставляйте его в GitHub, Worker-код или браузер.**
- Worker никогда не возвращает токен и секрет в JSON, но сохраняет часть диагностики (в том числе IP пользователя) в ответе текущему браузеру. Публичная страница не должна собирать приватные данные форм.
- Страница передаёт технические сведения о браузере и счётчики активности на ваш Worker. Они **не используются Google напрямую** для score: Google рассчитывает свою оценку самостоятельно.
- Проверка Origin/CORS ограничивает обращения из обычных браузеров, но не предотвращает запросы напрямую (curl, скрипты). Для публичного нагруженного использования добавьте rate limiting/anti-abuse меры.
- Данные отправляются в Google reCAPTCHA и Cloudflare. Учитывайте требования конфиденциальности/уведомления для реальных пользователей.
- Только размещения файлов недостаточно — надо указать ключи, домен и URL Worker.
- Бесплатные квоты Cloudflare/Google существуют и могут изменяться.

## Официальная документация

- https://developers.google.com/recaptcha/docs/v3
- https://developers.google.com/recaptcha/docs/verify
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/get-started/dashboard/
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site