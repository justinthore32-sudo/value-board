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
  const cfg = getAuthConfig();

  const links = NAV_ITEMS.map(([href, icon, label]) => {
    const active = href === current ? "active" : "";
    return `<a href="${href}" class="nav-link ${active}">${icon} ${label}</a>`;
  }).join("");

  const nav = document.createElement("nav");
  nav.className = "sidebar";
  nav.innerHTML = `
    <div class="sidebar-links">${links}</div>
    <div class="sidebar-footer">
      <p class="muted-small">Connecté : ${cfg ? cfg.username : ""}</p>
      <button id="logout-btn" class="btn-secondary" type="button">Déconnexion</button>
      <p class="disclaimer">⚠️ Protection basique côté navigateur — pas un vrai contrôle d'accès serveur. Données propres à cet appareil/navigateur (pas de synchronisation entre appareils).</p>
    </div>
  `;

  const layout = document.getElementById("layout");
  layout.prepend(nav);
  document.getElementById("logout-btn").addEventListener("click", logout);
}

document.addEventListener("DOMContentLoaded", renderNav);
