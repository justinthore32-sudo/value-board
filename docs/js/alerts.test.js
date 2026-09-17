// Tests unitaires du moteur d'alertes — port direct de l'ancienne suite Python (test_alerts.py).
// Lancer avec : node --test docs/js

const test = require("node:test");
const assert = require("node:assert/strict");

// alerts.js s'appuie sur isNum() (score.js) et todayISO() (db.js) comme globales
// navigateur — on les fournit ici avant de charger alerts.js.
global.isNum = require("./score.js").isNum;
global.todayISO = () => new Date().toISOString().slice(0, 10);

const { watchlistAlerts, portfolioAlerts } = require("./alerts.js");

const THRESHOLDS = {
  marge_securite_opportunite: 30.0, f_score_alerte: 4, dette_ebitda_alerte: 3.0,
  z_score_detresse: 1.81, z_score_sain: 2.99, verdict_achat_fort: 75.0, verdict_surveiller: 50.0,
};

function watchlistRow(overrides = {}) {
  return [{
    id: 1, ticker: "ABC", nom: "ABC Corp", secteur: "Tech", statut: "À surveiller",
    marge_securite_vis: null, f_score: null, dette_ebitda: null, z_score: null,
    ...overrides,
  }];
}

test("alerte opportunité se déclenche au-dessus du seuil", () => {
  const alerts = watchlistAlerts(watchlistRow({ marge_securite_vis: 35 }), THRESHOLDS);
  assert.ok(alerts.some((a) => a.type === "Opportunité" && a.severity === "info"));
});

test("alerte opportunité ne se déclenche pas sous le seuil", () => {
  const alerts = watchlistAlerts(watchlistRow({ marge_securite_vis: 10 }), THRESHOLDS);
  assert.ok(!alerts.some((a) => a.type === "Opportunité"));
});

test("alerte qualité faible (F-Score)", () => {
  const alerts = watchlistAlerts(watchlistRow({ f_score: 2 }), THRESHOLDS);
  assert.ok(alerts.some((a) => a.type === "Qualité faible" && a.severity === "warning"));
});

test("alerte dette élevée", () => {
  const alerts = watchlistAlerts(watchlistRow({ dette_ebitda: 4.0 }), THRESHOLDS);
  assert.ok(alerts.some((a) => a.type === "Dette élevée" && a.severity === "warning"));
});

test("alerte détresse financière", () => {
  const alerts = watchlistAlerts(watchlistRow({ z_score: 1.2 }), THRESHOLDS);
  assert.ok(alerts.some((a) => a.type === "Détresse financière" && a.severity === "critical"));
});

test("aucune alerte watchlist si rien ne franchit les seuils", () => {
  const alerts = watchlistAlerts(watchlistRow({ marge_securite_vis: 5, f_score: 8, dette_ebitda: 0.5, z_score: 3.5 }), THRESHOLDS);
  assert.deepEqual(alerts, []);
});

test("alerte objectif de prix atteint", () => {
  const portefeuille = [{ id: 1, ticker: "ABC", nom: "ABC Corp", prix_actuel: 120 }];
  const valorisations = [{ ticker: "ABC", methode: "Graham Number", valeur_intrinseque: 100, date_calcul: "2026-01-01" }];
  const alerts = portfolioAlerts(portefeuille, [], [], valorisations, THRESHOLDS);
  assert.ok(alerts.some((a) => a.type === "Objectif de prix atteint" && a.severity === "warning"));
});

test("pas d'alerte objectif de prix si sous la valeur intrinsèque", () => {
  const portefeuille = [{ id: 1, ticker: "ABC", nom: "ABC Corp", prix_actuel: 80 }];
  const valorisations = [{ ticker: "ABC", methode: "Graham Number", valeur_intrinseque: 100, date_calcul: "2026-01-01" }];
  const alerts = portfolioAlerts(portefeuille, [], [], valorisations, THRESHOLDS);
  assert.ok(!alerts.some((a) => a.type === "Objectif de prix atteint"));
});

test("alerte revue de thèse en retard", () => {
  const portefeuille = [{ id: 1, ticker: "ABC", nom: "ABC Corp", prix_actuel: null }];
  const watchlist = [{ id: 1, ticker: "ABC" }];
  const hier = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const theses = [{ watchlist_id: 1, date_revue: hier, date_creation: hier }];
  const alerts = portfolioAlerts(portefeuille, watchlist, theses, [], THRESHOLDS);
  assert.ok(alerts.some((a) => a.type === "Revue de thèse en retard" && a.severity === "critical"));
});

test("pas d'alerte de revue si date future", () => {
  const portefeuille = [{ id: 1, ticker: "ABC", nom: "ABC Corp", prix_actuel: null }];
  const watchlist = [{ id: 1, ticker: "ABC" }];
  const demain = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const theses = [{ watchlist_id: 1, date_revue: demain, date_creation: demain }];
  const alerts = portfolioAlerts(portefeuille, watchlist, theses, [], THRESHOLDS);
  assert.ok(!alerts.some((a) => a.type === "Revue de thèse en retard"));
});
