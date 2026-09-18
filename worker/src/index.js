/* ============================================
   MARGIN — Proxy Worker
   Authentification multi-comptes (admin + utilisateurs), données privées
   par compte. Le site GitHub Pages (docs/) n'appelle que ce Worker.
   ============================================ */

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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

/* Amorce un compte admin par défaut si le Worker n'a strictement aucun
   compte (premier démarrage, ou local wrangler dev à chaque test) — filet
   de sécurité pour ne jamais se retrouver bloqué sans aucun admin. Une fois
   qu'un compte existe, cette fonction ne fait plus rien. */
async function ensureAdminSeeded(env) {
  const existing = await env.STORE.list({ prefix: 'user:', limit: 1 });
  if (existing.keys.length > 0) return;
  const bootstrapPassword = env.ADMIN_BOOTSTRAP_PASSWORD || 'admin1234';
  const salt = randomHex(16);
  const hash = await hashPassword(bootstrapPassword, salt);
  await env.STORE.put('user:admin', JSON.stringify({
    username: 'admin',
    displayName: 'Admin',
    isAdmin: true,
    salt,
    hash,
    createdAt: Date.now(),
    lastLoginAt: null,
    lastSeenAt: null,
  }));
}

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

async function handleLogin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const attempts = await getLoginAttempts(env, ip);
  if (attempts.count >= LOGIN_MAX_ATTEMPTS) {
    return jsonResponse({ error: 'Trop de tentatives échouées. Réessaie dans 15 minutes.' }, env, 429);
  }

  const { username, password } = await request.json();
  if (!username || !password) return jsonResponse({ error: 'Identifiants manquants' }, env, 400);

  await ensureAdminSeeded(env);

  const key = `user:${username.toLowerCase()}`;
  const userRaw = await env.STORE.get(key);
  if (!userRaw) {
    await recordLoginFailure(env, ip);
    return jsonResponse({ error: 'Identifiants invalides' }, env, 401);
  }

  const user = JSON.parse(userRaw);
  const valid = await verifyPassword(password, user.salt, user.hash);
  if (!valid) {
    await recordLoginFailure(env, ip);
    return jsonResponse({ error: 'Identifiants invalides' }, env, 401);
  }

  await clearLoginAttempts(env, ip);

  const now = Date.now();
  const token = randomHex(32);
  await env.SESSIONS.put(`session:${token}`, JSON.stringify({
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    loginAt: now,
  }), { expirationTtl: SESSION_TTL_SECONDS });

  user.lastLoginAt = now;
  user.lastSeenAt = now;
  await env.STORE.put(key, JSON.stringify(user));

  return jsonResponse({ token, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin }, env);
}

/* isAdmin/displayName sont relus depuis la fiche compte à chaque requête
   (pas seulement au login) : sinon une promotion/rétrogradation admin ne
   prendrait effet qu'à la reconnexion suivante, ce qui serait déroutant. */
async function getSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const raw = await env.SESSIONS.get(`session:${token}`);
  if (!raw) return null;
  const session = { token, ...JSON.parse(raw) };

  const userRaw = await env.STORE.get(`user:${session.username}`);
  if (!userRaw) return null; // compte supprimé entre-temps
  const user = JSON.parse(userRaw);
  session.isAdmin = user.isAdmin;
  session.displayName = user.displayName;

  return session;
}

/* Met à jour "dernière activité" sur la fiche utilisateur (pour le panneau
   admin) — limité à 1 écriture toutes les 2 min pour ménager les quotas KV. */
async function touchUserActivity(env, username) {
  const key = `user:${username}`;
  const raw = await env.STORE.get(key);
  if (!raw) return;
  const user = JSON.parse(raw);
  const now = Date.now();
  if (user.lastSeenAt && now - user.lastSeenAt < 2 * 60 * 1000) return;
  user.lastSeenAt = now;
  await env.STORE.put(key, JSON.stringify(user));
}

async function handleLogout(request, env) {
  const session = await getSession(request, env);
  if (session) await env.SESSIONS.delete(`session:${session.token}`);
  return jsonResponse({ ok: true }, env);
}

async function handleMe(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Non authentifié' }, env, 401);
  return jsonResponse({ username: session.username, displayName: session.displayName, isAdmin: session.isAdmin }, env);
}

/* ---------- ADMINISTRATION (comptes + sessions) ---------- */

function formatDuration(ms) {
  if (!ms || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h${rem ? ` ${rem}min` : ''}`;
}

async function handleListUsers(request, env) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return jsonResponse({ error: 'Accès refusé' }, env, 403);

  const list = await env.STORE.list({ prefix: 'user:' });
  const users = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.STORE.get(k.name);
      const u = JSON.parse(raw);
      const sessionDurationMs = u.lastSeenAt && u.lastLoginAt ? u.lastSeenAt - u.lastLoginAt : null;
      return {
        username: u.username,
        displayName: u.displayName,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt || null,
        lastLoginAt: u.lastLoginAt || null,
        lastSeenAt: u.lastSeenAt || null,
        lastSessionDuration: formatDuration(sessionDurationMs),
      };
    })
  );
  users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return jsonResponse({ users }, env);
}

async function handleCreateUser(request, env) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return jsonResponse({ error: 'Accès refusé' }, env, 403);

  const { username, password, displayName, isAdmin } = await request.json();
  if (!username || !password) return jsonResponse({ error: 'Identifiants manquants' }, env, 400);
  if (password.length < 4) return jsonResponse({ error: 'Mot de passe trop court (4 caractères minimum)' }, env, 400);

  const key = `user:${username.toLowerCase()}`;
  const existing = await env.STORE.get(key);
  if (existing) return jsonResponse({ error: "Ce nom d'utilisateur existe déjà" }, env, 409);

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  await env.STORE.put(key, JSON.stringify({
    username: username.toLowerCase(),
    displayName: displayName || username,
    isAdmin: !!isAdmin,
    salt,
    hash,
    createdAt: Date.now(),
    lastLoginAt: null,
    lastSeenAt: null,
  }));
  return jsonResponse({ ok: true }, env);
}

async function handleUpdateUser(request, env, username) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return jsonResponse({ error: 'Accès refusé' }, env, 403);

  const key = `user:${username.toLowerCase()}`;
  const raw = await env.STORE.get(key);
  if (!raw) return jsonResponse({ error: 'Compte introuvable' }, env, 404);
  const user = JSON.parse(raw);

  const { displayName, isAdmin, password } = await request.json();

  if (isAdmin === false && user.isAdmin) {
    const list = await env.STORE.list({ prefix: 'user:' });
    const admins = await Promise.all(list.keys.map(async (k) => {
      const r = await env.STORE.get(k.name);
      return JSON.parse(r).isAdmin;
    }));
    if (admins.filter(Boolean).length <= 1) {
      return jsonResponse({ error: 'Impossible de retirer le dernier compte admin.' }, env, 400);
    }
  }

  if (displayName !== undefined) user.displayName = displayName;
  if (isAdmin !== undefined) user.isAdmin = !!isAdmin;
  if (password) {
    if (password.length < 4) return jsonResponse({ error: 'Mot de passe trop court (4 caractères minimum)' }, env, 400);
    const salt = randomHex(16);
    user.salt = salt;
    user.hash = await hashPassword(password, salt);
  }

  await env.STORE.put(key, JSON.stringify(user));
  return jsonResponse({ ok: true }, env);
}

async function handleDeleteUser(request, env, username) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return jsonResponse({ error: 'Accès refusé' }, env, 403);

  const lower = username.toLowerCase();
  if (lower === session.username.toLowerCase()) {
    return jsonResponse({ error: 'Impossible de supprimer ton propre compte.' }, env, 400);
  }

  const raw = await env.STORE.get(`user:${lower}`);
  if (!raw) return jsonResponse({ error: 'Compte introuvable' }, env, 404);
  const user = JSON.parse(raw);

  if (user.isAdmin) {
    const list = await env.STORE.list({ prefix: 'user:' });
    const admins = await Promise.all(list.keys.map(async (k) => {
      const r = await env.STORE.get(k.name);
      return JSON.parse(r).isAdmin;
    }));
    if (admins.filter(Boolean).length <= 1) {
      return jsonResponse({ error: 'Impossible de supprimer le dernier compte admin.' }, env, 400);
    }
  }

  await env.STORE.delete(`user:${lower}`);
  await env.STORE.delete(`data:${lower}`);
  return jsonResponse({ ok: true }, env);
}

async function handleListSessions(request, env) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return jsonResponse({ error: 'Accès refusé' }, env, 403);

  const list = await env.SESSIONS.list({ prefix: 'session:' });
  const sessions = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.SESSIONS.get(k.name);
      if (!raw) return null;
      const s = JSON.parse(raw);
      const token = k.name.slice('session:'.length);
      return {
        tokenMasked: `${token.slice(0, 6)}…${token.slice(-4)}`,
        tokenId: token,
        username: s.username,
        displayName: s.displayName,
        isCurrent: token === session.token,
        loginAt: s.loginAt || null,
      };
    })
  );
  const cleaned = sessions.filter(Boolean).sort((a, b) => (b.loginAt || 0) - (a.loginAt || 0));
  return jsonResponse({ sessions: cleaned }, env);
}

async function handleRevokeSession(request, env, token) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return jsonResponse({ error: 'Accès refusé' }, env, 403);
  await env.SESSIONS.delete(`session:${token}`);
  return jsonResponse({ ok: true }, env);
}

/* ---------- DONNÉES (privées par compte) ---------- */

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

async function handleGetData(request, env, username) {
  const raw = await env.STORE.get(`data:${username}`);
  const data = raw ? JSON.parse(raw) : emptyStore();
  return jsonResponse(data, env);
}

const MAX_DATA_BYTES = 2 * 1024 * 1024; // 2 Mo — largement suffisant pour un usage perso, évite un KV qui gonfle sans limite

async function handlePutData(request, env, username) {
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
  await env.STORE.put(`data:${username}`, raw);
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

async function refreshWatchlistDataFor(env, username) {
  const raw = await env.STORE.get(`data:${username}`);
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

  await env.STORE.put(`data:${username}`, JSON.stringify(data));
  return { updated, skipped };
}

async function refreshAllUsers(env) {
  const list = await env.STORE.list({ prefix: 'data:' });
  let updated = 0;
  let skipped = 0;
  for (const k of list.keys) {
    const username = k.name.slice('data:'.length);
    const r = await refreshWatchlistDataFor(env, username);
    updated += r.updated;
    skipped += r.skipped;
  }
  return { updated, skipped };
}

async function handleRefresh(request, env, username) {
  const result = await refreshWatchlistDataFor(env, username);
  return jsonResponse(result, env);
}

/* ---------- ROUTAGE ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ex: ['api','admin','users','bob']

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    try {
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return await handleLogin(request, env);
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        return await handleLogout(request, env);
      }
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        return await handleMe(request, env);
      }

      // Tout le reste nécessite une session valide.
      const session = await getSession(request, env);
      if (!session) return jsonResponse({ error: 'Non authentifié' }, env, 401);
      await touchUserActivity(env, session.username);

      if (url.pathname === '/api/data' && request.method === 'GET') {
        return await handleGetData(request, env, session.username);
      }
      if (url.pathname === '/api/data' && request.method === 'PUT') {
        return await handlePutData(request, env, session.username);
      }
      if (url.pathname === '/api/refresh' && request.method === 'POST') {
        return await handleRefresh(request, env, session.username);
      }

      // ---- Administration (réservé aux comptes admin) ----
      if (url.pathname === '/api/admin/users' && request.method === 'GET') {
        return await handleListUsers(request, env);
      }
      if (url.pathname === '/api/admin/users' && request.method === 'POST') {
        return await handleCreateUser(request, env);
      }
      if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'users' && parts[3] && request.method === 'PATCH') {
        return await handleUpdateUser(request, env, decodeURIComponent(parts[3]));
      }
      if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'users' && parts[3] && request.method === 'DELETE') {
        return await handleDeleteUser(request, env, decodeURIComponent(parts[3]));
      }
      if (url.pathname === '/api/admin/sessions' && request.method === 'GET') {
        return await handleListSessions(request, env);
      }
      if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'sessions' && parts[3] && request.method === 'DELETE') {
        return await handleRevokeSession(request, env, decodeURIComponent(parts[3]));
      }
    } catch (err) {
      return jsonResponse({ error: err.message }, env, 500);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(env) });
  },

  // Cron Trigger toutes les 30 min (voir wrangler.toml [triggers]) — même
  // logique que POST /api/refresh, déclenchée automatiquement pour tous les
  // comptes.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshAllUsers(env));
  },
};
