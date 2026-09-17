/* Moteur d'alertes — port direct de alerts.py. */

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const SEVERITY_ICON = { critical: "🔴", warning: "🟠", info: "🟢" };

function watchlistAlerts(watchlist, thresholds) {
  const alerts = [];
  for (const row of watchlist) {
    const ticker = row.ticker;
    const nom = row.nom || "";

    if (isNum(row.marge_securite_vis) && Number(row.marge_securite_vis) >= (thresholds.marge_securite_opportunite ?? 30.0)) {
      alerts.push({
        ticker, nom, categorie: "Watchlist", severity: "info", type: "Opportunité",
        message: `Marge de sécurité de ${Number(row.marge_securite_vis).toFixed(1)}% ≥ seuil (${(thresholds.marge_securite_opportunite ?? 30.0).toFixed(0)}%).`,
      });
    }
    if (isNum(row.f_score) && Number(row.f_score) < (thresholds.f_score_alerte ?? 4)) {
      alerts.push({
        ticker, nom, categorie: "Watchlist", severity: "warning", type: "Qualité faible",
        message: `Piotroski F-Score de ${Number(row.f_score)} < seuil (${Math.trunc(thresholds.f_score_alerte ?? 4)}).`,
      });
    }
    if (isNum(row.dette_ebitda) && Number(row.dette_ebitda) > (thresholds.dette_ebitda_alerte ?? 3.0)) {
      alerts.push({
        ticker, nom, categorie: "Watchlist", severity: "warning", type: "Dette élevée",
        message: `Dette/EBITDA de ${Number(row.dette_ebitda).toFixed(1)}x > seuil (${(thresholds.dette_ebitda_alerte ?? 3.0).toFixed(1)}x).`,
      });
    }
    if (isNum(row.z_score) && Number(row.z_score) < (thresholds.z_score_detresse ?? 1.81)) {
      alerts.push({
        ticker, nom, categorie: "Watchlist", severity: "critical", type: "Détresse financière",
        message: `Altman Z-Score de ${Number(row.z_score).toFixed(2)} sous le seuil de détresse (${(thresholds.z_score_detresse ?? 1.81).toFixed(2)}).`,
      });
    }
  }
  return alerts;
}

function portfolioAlerts(portefeuille, watchlist, theses, valorisations, thresholds) {
  const alerts = [];
  const today = todayISO();

  for (const row of portefeuille) {
    const ticker = row.ticker;
    const nom = row.nom || "";

    const valTicker = valorisations
      .filter((v) => v.ticker === ticker)
      .sort((a, b) => (b.date_calcul || "").localeCompare(a.date_calcul || ""));
    if (valTicker.length && isNum(row.prix_actuel)) {
      const derniere = valTicker[0];
      if (isNum(derniere.valeur_intrinseque) && Number(row.prix_actuel) >= Number(derniere.valeur_intrinseque)) {
        alerts.push({
          ticker, nom, categorie: "Portefeuille", severity: "warning", type: "Objectif de prix atteint",
          message: `Prix actuel (${Number(row.prix_actuel).toFixed(2)}) ≥ dernière valeur intrinsèque calculée (${Number(derniere.valeur_intrinseque).toFixed(2)}, méthode ${derniere.methode}) — à réévaluer.`,
        });
      }
    }

    const wlMatch = watchlist.find((w) => w.ticker === ticker);
    if (wlMatch) {
      const th = theses
        .filter((t) => t.watchlist_id === wlMatch.id)
        .sort((a, b) => (b.date_creation || "").localeCompare(a.date_creation || ""));
      if (th.length) {
        const derniereRevue = th[0].date_revue;
        if (derniereRevue && derniereRevue < today) {
          const jours = Math.round((new Date(today) - new Date(derniereRevue)) / 86400000);
          alerts.push({
            ticker, nom, categorie: "Portefeuille", severity: "critical", type: "Revue de thèse en retard",
            message: `Date de revue dépassée depuis ${jours} jour(s) (${derniereRevue}).`,
          });
        }
      }
    }
  }
  return alerts;
}

function allAlerts(watchlist, portefeuille, theses, valorisations, thresholds) {
  const items = [
    ...watchlistAlerts(watchlist, thresholds),
    ...portfolioAlerts(portefeuille, watchlist, theses, valorisations, thresholds),
  ];
  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return items;
}

if (typeof module !== "undefined") {
  module.exports = { SEVERITY_ORDER, SEVERITY_ICON, watchlistAlerts, portfolioAlerts, allAlerts };
}
