/* Injecte la barre latérale commune sur chaque page (hors login.html). */

const NAV_ITEMS = [
  ["index.html", "🧭", "Accueil"],
  ["watchlist.html", "🔎", "Watchlist"],
  ["fiche-titre.html", "🗂️", "Fiche Titre"],
  ["comparateur.html", "⚖️", "Comparateur"],
  ["alertes.html", "🚨", "Alertes"],
  ["portefeuille.html", "💼", "Portefeuille"],
  ["journal.html", "📓", "Journal"],
  ["reglages.html", "⚙️", "Réglages"],
];

const ADMIN_NAV_ITEM = ["admin.html", "🛡️", "Administration"];

const EXTERNAL_LINKS = [
  ["https://justinthore32-sudo.github.io/Ju-Board/", "🗞️", "Ju Board"],
];

function renderNav() {
  const current = window.location.pathname.split("/").pop() || "index.html";
  const username = localStorage.getItem("valueboard_display_name") || localStorage.getItem("valueboard_username") || "";
  const navItems = isAdmin() ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  const links = navItems.map(([href, icon, label]) => {
    const active = href === current ? "active" : "";
    return `<a href="${href}" class="nav-link ${active}">${icon} ${label}</a>`;
  }).join("");

  const externalLinks = EXTERNAL_LINKS.map(([href, icon, label]) => `
    <a href="${href}" class="nav-link" target="_blank" rel="noopener">${icon} ${label} ↗</a>
  `).join("");

  const nav = document.createElement("nav");
  nav.className = "sidebar";
  nav.innerHTML = `
    <div class="sidebar-brand">
      <img src="favicon.svg" alt="" class="brand-logo">
      <span class="brand-name">Margin</span>
    </div>
    <div class="sidebar-links">${links}</div>
    <div class="sidebar-footer">
      <div id="sync-error-banner" class="error-box" style="display:none; margin-bottom:10px; font-size:12px;"></div>
      <div class="sidebar-links" style="border-top:1px solid var(--border); padding-top:8px; margin-bottom:10px;">${externalLinks}</div>
      <button id="theme-toggle" class="btn-secondary" type="button" style="width:100%; margin-bottom:10px;">🌙 Mode sombre</button>
      <p class="muted-small">Connecté : ${username}</p>
      <button id="logout-btn" class="btn-secondary" type="button">Déconnexion</button>
    </div>
  `;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "mobile-toggle";
  toggle.textContent = "☰ Menu";
  toggle.addEventListener("click", () => nav.classList.toggle("open"));

  const layout = document.getElementById("layout");
  layout.prepend(nav);
  layout.prepend(toggle);
  document.getElementById("logout-btn").addEventListener("click", logout);

  const themeBtn = document.getElementById("theme-toggle");
  const updateThemeLabel = () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    themeBtn.textContent = isDark ? "☀️ Mode clair" : "🌙 Mode sombre";
  };
  updateThemeLabel();
  themeBtn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("valueboard_theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("valueboard_theme", "dark");
    }
    updateThemeLabel();
  });

  window.addEventListener("valueboard-sync-error", (e) => {
    const banner = document.getElementById("sync-error-banner");
    banner.style.display = "block";
    banner.textContent = `⚠️ Échec de synchronisation avec le serveur : ${e.detail}. Tes derniers changements ne sont peut-être pas sauvegardés.`;
  });
}

document.addEventListener("DOMContentLoaded", renderNav);
