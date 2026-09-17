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

function renderNav() {
  const current = window.location.pathname.split("/").pop() || "index.html";
  const username = localStorage.getItem("valueboard_username") || "";

  const links = NAV_ITEMS.map(([href, icon, label]) => {
    const active = href === current ? "active" : "";
    return `<a href="${href}" class="nav-link ${active}">${icon} ${label}</a>`;
  }).join("");

  const nav = document.createElement("nav");
  nav.className = "sidebar";
  nav.innerHTML = `
    <div class="sidebar-links">${links}</div>
    <div class="sidebar-footer">
      <div id="sync-error-banner" class="error-box" style="display:none; margin-bottom:10px; font-size:12px;"></div>
      <p class="muted-small">Connecté : ${username}</p>
      <button id="logout-btn" class="btn-secondary" type="button">Déconnexion</button>
    </div>
  `;

  const layout = document.getElementById("layout");
  layout.prepend(nav);
  document.getElementById("logout-btn").addEventListener("click", logout);

  window.addEventListener("valueboard-sync-error", (e) => {
    const banner = document.getElementById("sync-error-banner");
    banner.style.display = "block";
    banner.textContent = `⚠️ Échec de synchronisation avec le serveur : ${e.detail}. Tes derniers changements ne sont peut-être pas sauvegardés.`;
  });
}

document.addEventListener("DOMContentLoaded", renderNav);
