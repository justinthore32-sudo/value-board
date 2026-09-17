/* ============================================
   VALUEBOARD — Proxy Worker
   Authentification et stockage des données, mono-utilisateur.
   Le site GitHub Pages (docs/) n'appelle que ce Worker.
   ============================================ */

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(env), 'content-type': 'application/json' },
  });
}

/* ---------- AUTHENTIFICATION ---------- */

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLength) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const saltBytes = new Uint8Array(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

async function verifyPassword(password, saltHex, hashHex) {
  const computed = await hashPassword(password, saltHex);
  return computed === hashHex;
}

const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 jours

async function getLoginAttempts(env, ip) {
  const raw = await env.SESSIONS.get(`loginattempts:${ip}`);
  return raw ? JSON.parse(raw) : { count: 0 };
}

async function recordLoginFailure(env, ip) {
  const attempts = await getLoginAttempts(env, ip);
  attempts.count += 1;
  await env.SESSIONS.put(`loginattempts:${ip}`, JSON.stringify(attempts), { expirationTtl: LOGIN_LOCKOUT_SECONDS });
}

async function clearLoginAttempts(env, ip) {
  await env.SESSIONS.delete(`loginattempts:${ip}`);
}

async function handleSetup(request, env) {
  const existing = await env.STORE.get('account');
  if (existing) {
    return jsonResponse({ error: 'Un compte existe déjà sur ce Worker.' }, env, 409);
  }

  const { username, password } = await request.json();
  if (!username || !password) return jsonResponse({ error: 'Identifiants manquants' }, env, 400);

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  await env.STORE.put('account', JSON.stringify({ username, salt, hash, createdAt: Date.now() }));

  const token = randomHex(32);
  await env.SESSIONS.put(`session:${token}`, JSON.stringify({ username, loginAt: Date.now() }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });

  return jsonResponse({ token, username }, env);
}

async function handleLogin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const attempts = await getLoginAttempts(env, ip);
  if (attempts.count >= LOGIN_MAX_ATTEMPTS) {
    return jsonResponse({ error: 'Trop de tentatives échouées. Réessaie dans 15 minutes.' }, env, 429);
  }

  const { username, password } = await request.json();
  if (!username || !password) return jsonResponse({ error: 'Identifiants manquants' }, env, 400);

  const raw = await env.STORE.get('account');
  if (!raw) return jsonResponse({ error: 'Aucun compte configuré — utilise /api/auth/setup.' }, env, 400);

  const account = JSON.parse(raw);
  const valid = username === account.username && (await verifyPassword(password, account.salt, account.hash));
  if (!valid) {
    await recordLoginFailure(env, ip);
    return jsonResponse({ error: 'Identifiants invalides' }, env, 401);
  }

  await clearLoginAttempts(env, ip);

  const token = randomHex(32);
  await env.SESSIONS.put(`session:${token}`, JSON.stringify({ username: account.username, loginAt: Date.now() }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });

  return jsonResponse({ token, username: account.username }, env);
}

async function getSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const raw = await env.SESSIONS.get(`session:${token}`);
  if (!raw) return null;
  return { token, ...JSON.parse(raw) };
}

async function handleLogout(request, env) {
  const session = await getSession(request, env);
  if (session) await env.SESSIONS.delete(`session:${session.token}`);
  return jsonResponse({ ok: true }, env);
}

async function handleAccountExists(env) {
  const existing = await env.STORE.get('account');
  return jsonResponse({ exists: Boolean(existing) }, env);
}

/* ---------- DONNÉES ---------- */

const DEFAULT_WEIGHTS = {
  marge_securite: 25,
  f_score: 20,
  z_score: 15,
  dette_ebitda: 15,
  roe: 15,
  dividende: 10,
};

const DEFAULT_THRESHOLDS = {
  marge_securite_opportunite: 30.0,
  f_score_alerte: 4,
  dette_ebitda_alerte: 3.0,
  z_score_detresse: 1.81,
  z_score_sain: 2.99,
  verdict_achat_fort: 75.0,
  verdict_surveiller: 50.0,
};

function emptyStore() {
  return {
    watchlist: [],
    portefeuille: [],
    theses: [],
    valorisations: [],
    settings: { weights: { ...DEFAULT_WEIGHTS }, thresholds: { ...DEFAULT_THRESHOLDS } },
    nextIds: { watchlist: 1, portefeuille: 1, theses: 1, valorisations: 1 },
  };
}

async function handleGetData(request, env) {
  const raw = await env.STORE.get('data');
  const data = raw ? JSON.parse(raw) : emptyStore();
  return jsonResponse(data, env);
}

const MAX_DATA_BYTES = 2 * 1024 * 1024; // 2 Mo — largement suffisant pour un usage perso, évite un KV qui gonfle sans limite

async function handlePutData(request, env) {
  const raw = await request.text();
  if (raw.length > MAX_DATA_BYTES) {
    return jsonResponse({ error: `Données trop volumineuses (max ${MAX_DATA_BYTES / 1024 / 1024} Mo).` }, env, 413);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return jsonResponse({ error: 'JSON invalide' }, env, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return jsonResponse({ error: 'Format invalide' }, env, 400);
  }
  await env.STORE.put('data', raw);
  return jsonResponse({ ok: true }, env);
}

/* ---------- AUTO-REFRESH (Finnhub) ----------
   Ne couvre que le prix/PER/ROE/P-B des tickers cotés sur les places gérées
   par l'offre gratuite Finnhub (US notamment) ; renvoie null proprement pour
   les autres (ex. micro-caps parisiens) — laissés inchangés, pas une erreur.
   La marge de sécurité VIS, le F-Score, le Z-Score et la checklist Graham ne
   sont volontairement jamais touchés : aucune API ne reproduit la méthode
   propriétaire de VIS pour la marge de sécurité, et les scores ne sont pas
   disponibles sur l'offre gratuite. */

async function fetchFinnhubData(ticker, env) {
  if (!env.FINNHUB_KEY) return null;
  try {
    const [quoteRes, metricRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${env.FINNHUB_KEY}`),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${env.FINNHUB_KEY}`),
    ]);
    if (!quoteRes.ok || !metricRes.ok) return null;

    const quote = await quoteRes.json();
    const metric = await metricRes.json();
    const m = metric.metric || {};

    // quote.c === 0 : Finnhub répond "OK" sans données réelles (ticker non couvert)
    if (!quote || !quote.c) return null;

    return {
      prix_actuel: quote.c,
      per: typeof m.peTTM === 'number' ? m.peTTM : undefined,
      roe: typeof m.roeTTM === 'number' ? m.roeTTM : undefined,
      pb: typeof m.pbAnnual === 'number' ? m.pbAnnual : undefined,
    };
  } catch (e) {
    return null;
  }
}

async function refreshWatchlistData(env) {
  const raw = await env.STORE.get('data');
  if (!raw) return { updated: 0, skipped: 0 };

  const data = JSON.parse(raw);
  const today = new Date().toISOString().slice(0, 10);
  let updated = 0;
  let skipped = 0;

  for (const row of data.watchlist || []) {
    const fresh = await fetchFinnhubData(row.ticker, env);
    if (!fresh) {
      skipped += 1;
      continue;
    }
    if (fresh.prix_actuel !== undefined) row.prix_actuel = fresh.prix_actuel;
    if (fresh.per !== undefined) row.per = fresh.per;
    if (fresh.roe !== undefined) row.roe = fresh.roe;
    if (fresh.pb !== undefined) row.pb = fresh.pb;
    row.derniere_maj_auto = today;
    updated += 1;
  }

  await env.STORE.put('data', JSON.stringify(data));
  return { updated, skipped };
}

async function handleRefresh(request, env) {
  const result = await refreshWatchlistData(env);
  return jsonResponse(result, env);
}

/* ---------- ROUTAGE ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    try {
      if (url.pathname === '/api/auth/account' && request.method === 'GET') {
        return await handleAccountExists(env);
      }
      if (url.pathname === '/api/auth/setup' && request.method === 'POST') {
        return await handleSetup(request, env);
      }
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return await handleLogin(request, env);
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        return await handleLogout(request, env);
      }

      // Tout le reste nécessite une session valide.
      const session = await getSession(request, env);
      if (!session) return jsonResponse({ error: 'Non authentifié' }, env, 401);

      if (url.pathname === '/api/data' && request.method === 'GET') {
        return await handleGetData(request, env);
      }
      if (url.pathname === '/api/data' && request.method === 'PUT') {
        return await handlePutData(request, env);
      }
      if (url.pathname === '/api/refresh' && request.method === 'POST') {
        return await handleRefresh(request, env);
      }
    } catch (err) {
      return jsonResponse({ error: err.message }, env, 500);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(env) });
  },

  // Cron Trigger quotidien (voir wrangler.toml [triggers]) — même logique
  // que POST /api/refresh, déclenchée automatiquement sans action de l'utilisateur.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshWatchlistData(env));
  },
};
