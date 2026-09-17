/* Garde d'accès côté client — PAS une vraie protection serveur.
   N'importe qui peut lire ce fichier et contourner le contrôle : c'est un
   simple verrou de confort, pas une barrière de sécurité. Les identifiants
   sont propres à ce navigateur (localStorage), la session à cet onglet
   (sessionStorage). */

const AUTH_KEY = "valueboard_auth";
const SESSION_KEY = "valueboard_session";

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSaltHex() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  // Un simple SHA-256 salé suffit ici : ce n'est déjà pas une vraie protection
  // (le code est public), PBKDF2 n'apporterait rien de plus dans ce contexte.
  return sha256Hex(`${salt}:${password}`);
}

function getAuthConfig() {
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function setCredentials(username, password) {
  const salt = randomSaltHex();
  const hash = await hashPassword(password, salt);
  localStorage.setItem(AUTH_KEY, JSON.stringify({ username, hash, salt }));
}

async function checkCredentials(username, password) {
  const cfg = getAuthConfig();
  if (!cfg) return false;
  const hash = await hashPassword(password, cfg.salt);
  return username === cfg.username && hash === cfg.hash;
}

function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

function setAuthenticated() {
  sessionStorage.setItem(SESSION_KEY, "1");
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  window.location.href = "login.html";
}
