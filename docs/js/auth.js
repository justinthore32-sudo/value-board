/* Authentification — vérifiée côté serveur (Worker Cloudflare), plus un
   simple verrou côté navigateur. Le token de session est stocké dans
   localStorage (voir api.js) : il ne prouve rien par lui-même, c'est le
   Worker qui valide chaque appel. */

async function accountExists() {
  const res = await apiGet("/api/auth/account");
  return res.exists;
}

async function setupAccount(username, password) {
  const res = await apiPost("/api/auth/setup", { username, password });
  setToken(res.token);
  localStorage.setItem("valueboard_username", res.username);
}

async function login(username, password) {
  const res = await apiPost("/api/auth/login", { username, password });
  setToken(res.token);
  localStorage.setItem("valueboard_username", res.username);
}

async function logout() {
  try {
    await apiPost("/api/auth/logout", {});
  } catch (e) {
    // le token est peut-être déjà invalide côté serveur — on nettoie quand même localement
  }
  clearToken();
  localStorage.removeItem("valueboard_username");
  window.location.href = "login.html";
}

function isAuthenticated() {
  return Boolean(getToken());
}
