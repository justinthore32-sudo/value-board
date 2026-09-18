/* Authentification — vérifiée côté serveur (Worker Cloudflare), plus un
   simple verrou côté navigateur. Le token de session est stocké dans
   localStorage (voir api.js) : il ne prouve rien par lui-même, c'est le
   Worker qui valide chaque appel. */

async function login(username, password) {
  const res = await apiPost("/api/auth/login", { username, password });
  setToken(res.token);
  localStorage.setItem("valueboard_username", res.username);
  localStorage.setItem("valueboard_display_name", res.displayName || res.username);
  localStorage.setItem("valueboard_is_admin", res.isAdmin ? "1" : "");
}

async function logout() {
  try {
    await apiPost("/api/auth/logout", {});
  } catch (e) {
    // le token est peut-être déjà invalide côté serveur — on nettoie quand même localement
  }
  clearToken();
  localStorage.removeItem("valueboard_username");
  localStorage.removeItem("valueboard_display_name");
  localStorage.removeItem("valueboard_is_admin");
  window.location.href = "login.html";
}

function isAuthenticated() {
  return Boolean(getToken());
}

function isAdmin() {
  return localStorage.getItem("valueboard_is_admin") === "1";
}

/* ---------- Administration (comptes + sessions) ---------- */

function adminListUsers() {
  return apiGet("/api/admin/users");
}

function adminCreateUser(username, password, displayName, isAdminFlag) {
  return apiPost("/api/admin/users", { username, password, displayName, isAdmin: isAdminFlag });
}

function adminUpdateUser(username, patch) {
  return apiPatch(`/api/admin/users/${encodeURIComponent(username)}`, patch);
}

function adminDeleteUser(username) {
  return apiDelete(`/api/admin/users/${encodeURIComponent(username)}`);
}

function adminListSessions() {
  return apiGet("/api/admin/sessions");
}

function adminRevokeSession(tokenId) {
  return apiDelete(`/api/admin/sessions/${encodeURIComponent(tokenId)}`);
}
