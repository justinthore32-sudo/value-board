/* Client HTTP vers le Worker Cloudflare — vraie synchro + vraie authentification.
   PROXY_URL sera mis à jour avec l'URL réelle du Worker après déploiement. */

const PROXY_URL = "https://value-board-proxy.ju-board-justin.workers.dev";

const TOKEN_KEY = "valueboard_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function apiRequest(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${PROXY_URL}${path}`, { ...options, headers });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  if (!res.ok) {
    const message = (body && body.error) || `Erreur réseau (${res.status})`;
    throw new Error(message);
  }
  return body;
}

function apiGet(path) {
  return apiRequest(path, { method: "GET" });
}

function apiPost(path, data) {
  return apiRequest(path, { method: "POST", body: JSON.stringify(data) });
}

function apiPut(path, data) {
  return apiRequest(path, { method: "PUT", body: JSON.stringify(data) });
}

function apiPatch(path, data) {
  return apiRequest(path, { method: "PATCH", body: JSON.stringify(data) });
}

function apiDelete(path) {
  return apiRequest(path, { method: "DELETE" });
}
