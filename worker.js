/**
 * Cloudflare Worker для проверки reCAPTCHA v3 с GitHub Pages.
 * ВАЖНО: здесь нет SECRET_KEY — добавьте его через Settings > Variables and Secrets > Secret.
 *
 * Домен уже настроен для bullet2013.github.io.
 * Для сайта https://username.github.io/repo/ оба значения относятся только к hostname:
 * ALLOWED_ORIGIN = 'https://username.github.io'
 * EXPECTED_HOSTNAME = 'username.github.io'
 */

const ALLOWED_ORIGIN = 'https://bullet2013.github.io';
const EXPECTED_HOSTNAME = 'bullet2013.github.io';
const EXPECTED_ACTION = 'login';

function json(data, status = 200, origin = null) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  });
  if (origin === ALLOWED_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
    headers.set('Access-Control-Max-Age', '600');
  }
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'GET') {
      return json({ service: 'recaptcha-v3-checker', status: 'ready', endpoint: 'POST /' }, 200);
    }

    if (origin !== ALLOWED_ORIGIN) {
      // CORS — ограничение для браузеров, НЕ полноценная защита от запросов из других клиентов.
      return json({ ok: false, error: 'origin_not_allowed' }, 403);
    }

    if (request.method === 'OPTIONS') {
      const headers = new Headers({
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store',
        'Vary': 'Origin'
      });
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
    }

    if (url.pathname !== '/') {
      return json({ ok: false, error: 'not_found' }, 404, origin);
    }

    if (!env.RECAPTCHA_SECRET_KEY) {
      return json({ ok: false, error: 'secret_not_configured' }, 500, origin);
    }

    if (!(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) {
      return json({ ok: false, error: 'expected_json' }, 415, origin);
    }

    let payload;
    try {
      const raw = await request.text();
      if (raw.length > 24000) return json({ ok: false, error: 'request_too_large' }, 413, origin);
      payload = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, origin);
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json({ ok: false, error: 'request_body_must_be_object' }, 400, origin);
    }

    const token = payload.token;
    if (typeof token !== 'string' || token.length < 20 || token.length > 8000) {
      return json({ ok: false, error: 'recaptcha_token_missing_or_invalid' }, 400, origin);
    }

    const clientIp = request.headers.get('CF-Connecting-IP') || null;
    const body = new URLSearchParams({
      secret: env.RECAPTCHA_SECRET_KEY,
      response: token
    });
    if (clientIp) body.set('remoteip', clientIp);

    let googleRawResponse, googleHttpStatus, googleResponse;
    const startedAt = Date.now();
    try {
      const googleRequest = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      });
      googleHttpStatus = googleRequest.status;
      googleRawResponse = await googleRequest.text();
      googleResponse = JSON.parse(googleRawResponse);
    } catch {
      return json({ ok: false, error: 'google_request_failed', message: 'Не удалось получить корректный ответ Google.' }, 502, origin);
    }

    if (googleHttpStatus !== 200 || !googleResponse || typeof googleResponse !== 'object') {
      return json({ ok: false, error: 'invalid_google_response', google_http_status: googleHttpStatus }, 502, origin);
    }

    // При превышении бесплатной квоты Google может отвечать успехом и фиктивным score 0.9.
    const overQuota = /over free quota/i.test(googleRawResponse);
    const googleSuccess = googleResponse.success === true;
    const actionMatches = googleResponse.action === EXPECTED_ACTION;
    const hostnameMatches = googleResponse.hostname === EXPECTED_HOSTNAME;
    const score = !overQuota && typeof googleResponse.score === 'number' &&
      googleResponse.score >= 0 && googleResponse.score <= 1
      ? googleResponse.score
      : null;
    const ok = googleSuccess && actionMatches && hostnameMatches && score !== null && !overQuota;

    return json({
      ok,
      summary: {
        success: googleSuccess,
        score,
        expected_action: EXPECTED_ACTION,
        returned_action: googleResponse.action ?? null,
        action_matches: actionMatches,
        expected_hostname: EXPECTED_HOSTNAME,
        returned_hostname: googleResponse.hostname ?? null,
        hostname_matches: hostnameMatches,
        above_example_threshold_0_5: score === null ? null : score >= 0.5,
        over_free_quota: overQuota
      },
      received_by_worker: {
        received_at_utc: new Date().toISOString(),
        method: request.method,
        path: url.pathname,
        origin,
        client_ip: clientIp,
        user_agent: request.headers.get('User-Agent') || null,
        token_length: token.length,
        requested_action: payload.requestedAction ?? null,
        client_data: payload.clientData ?? null,
        activity: payload.activity ?? null
      },
      request_sent_to_google: {
        endpoint: 'https://www.google.com/recaptcha/api/siteverify',
        method: 'POST',
        parameters: {
          secret: '[СКРЫТО]',
          response: '[СКРЫТО]',
          remoteip: clientIp
        },
        http_status: googleHttpStatus,
        duration_ms: Date.now() - startedAt
      },
      google_response: googleResponse,
      google_raw_response: googleRawResponse
    }, 200, origin);
  }
};