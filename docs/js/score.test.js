// Tests unitaires du moteur de scoring — port direct de l'ancienne suite Python (test_score.py).
// Lancer avec : node --test docs/js

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeMetric, computeScore, verdictLabel, checklistStatus, checklistPassRate,
  resolveZScoreThresholds, computeFScoreFromDetails, sectorStats, median,
} = require("./score.js");

const THRESHOLDS = {
  marge_securite_opportunite: 30.0, f_score_alerte: 4, dette_ebitda_alerte: 3.0,
  z_score_detresse: 1.81, z_score_sain: 2.99, verdict_achat_fort: 75.0, verdict_surveiller: 50.0,
};
const WEIGHTS = { marge_securite: 25, f_score: 20, z_score: 15, dette_ebitda: 15, roe: 15, dividende: 10 };

test("normalizeMetric: donnée manquante renvoie null", () => {
  assert.equal(normalizeMetric("marge_securite", null, THRESHOLDS), null);
  assert.equal(normalizeMetric("f_score", NaN, THRESHOLDS), null);
});

test("normalizeMetric: clip haut et bas", () => {
  assert.equal(normalizeMetric("marge_securite", 100, THRESHOLDS), 100);
  assert.equal(normalizeMetric("marge_securite", -10, THRESHOLDS), 0);
});

test("normalizeMetric: dette/EBITDA inversé", () => {
  assert.equal(normalizeMetric("dette_ebitda", 0, THRESHOLDS), 100);
  assert.equal(normalizeMetric("dette_ebitda", 5, THRESHOLDS), 0);
  assert.equal(normalizeMetric("dette_ebitda", 10, THRESHOLDS), 0);
});

test("normalizeMetric: interpolation Z-Score", () => {
  assert.equal(normalizeMetric("z_score", 1.81, THRESHOLDS), 0);
  assert.equal(normalizeMetric("z_score", 2.99, THRESHOLDS), 100);
  const milieu = normalizeMetric("z_score", (1.81 + 2.99) / 2, THRESHOLDS);
  assert.ok(milieu > 49 && milieu < 51);
});

test("computeScore: titre complet Achat fort", () => {
  const row = { marge_securite_vis: 45, f_score: 8, z_score: 3.5, dette_ebitda: 0.5, roe: 20, rendement_dividende: 4 };
  const result = computeScore(row, WEIGHTS, THRESHOLDS);
  assert.notEqual(result.score, null);
  assert.equal(result.coverage, 6);
  assert.equal(result.verdict, "Achat fort");
});

test("computeScore: métriques manquantes non pénalisées", () => {
  const row = { marge_securite_vis: 45, f_score: null, z_score: null, dette_ebitda: null, roe: null, rendement_dividende: null };
  const result = computeScore(row, WEIGHTS, THRESHOLDS);
  assert.equal(result.coverage, 1);
  assert.equal(result.score, 90.0);
});

test("computeScore: aucune métrique disponible", () => {
  const row = { marge_securite_vis: null, f_score: null, z_score: null, dette_ebitda: null, roe: null, rendement_dividende: null };
  const result = computeScore(row, WEIGHTS, THRESHOLDS);
  assert.equal(result.score, null);
  assert.equal(result.verdict, "Données insuffisantes");
});

test("computeScore: titre en détresse financière", () => {
  const row = { marge_securite_vis: 10, f_score: 3, z_score: 1.0, dette_ebitda: 4.5, roe: 2, rendement_dividende: 0 };
  const result = computeScore(row, WEIGHTS, THRESHOLDS);
  assert.equal(result.subScores.z_score, 0);
  assert.equal(result.verdict, "Écarter");
});

test("verdictLabel: seuils", () => {
  assert.equal(verdictLabel(75, THRESHOLDS), "Achat fort");
  assert.equal(verdictLabel(74.9, THRESHOLDS), "À surveiller");
  assert.equal(verdictLabel(50, THRESHOLDS), "À surveiller");
  assert.equal(verdictLabel(49.9, THRESHOLDS), "Écarter");
  assert.equal(verdictLabel(null, THRESHOLDS), "Données insuffisantes");
});

test("checklist: critères auto PER/valorisation modérés", () => {
  const statuses = Object.fromEntries(checklistStatus({ per: 12, pb: 1.0 }).map((s) => [s.key, s.value]));
  assert.equal(statuses.per_modere, true);
  assert.equal(statuses.valorisation_moderee, true);
});

test("checklist: données manquantes → null", () => {
  const statuses = Object.fromEntries(checklistStatus({ per: null, pb: null }).map((s) => [s.key, s.value]));
  assert.equal(statuses.per_modere, null);
  assert.equal(statuses.valorisation_moderee, null);
});

test("checklistPassRate: ignore les critères inconnus", () => {
  const row = {
    taille_ok: 1, bilan_solide: 0, benefices_stables: null,
    dividende_continu: null, croissance_benefices: null, per: 20, pb: 3,
  };
  const [passed, known] = checklistPassRate(row);
  assert.equal(known, 4);
  assert.equal(passed, 1);
});

test("resolveZScoreThresholds: modèle original suit les seuils personnalisés", () => {
  const custom = { z_score_detresse: 2.0, z_score_sain: 3.5 };
  assert.deepEqual(resolveZScoreThresholds("original", custom), { detresse: 2.0, sain: 3.5 });
  assert.deepEqual(resolveZScoreThresholds(undefined, custom), { detresse: 2.0, sain: 3.5 });
});

test("resolveZScoreThresholds: modèles Z′ et Z″ utilisent leurs seuils fixes", () => {
  assert.deepEqual(resolveZScoreThresholds("prive", THRESHOLDS), { detresse: 1.23, sain: 2.90 });
  assert.deepEqual(resolveZScoreThresholds("em_service", THRESHOLDS), { detresse: 1.10, sain: 2.60 });
});

test("normalizeMetric: le modèle Z-Score de la ligne change l'interprétation", () => {
  // 1.5 est en détresse pour le modèle original (seuil 1.81) mais sain pour Z″ (seuil 1.10-2.60)
  assert.equal(normalizeMetric("z_score", 1.5, THRESHOLDS), 0);
  const viaPrive = normalizeMetric("z_score", 1.5, THRESHOLDS, "em_service");
  assert.ok(viaPrive > 0 && viaPrive < 100);
});

test("computeFScoreFromDetails: renvoie null si incomplet", () => {
  assert.equal(computeFScoreFromDetails(null), null);
  assert.equal(computeFScoreFromDetails({ roa_positif: 1, cfo_positif: 1 }), null);
});

test("computeFScoreFromDetails: somme les 9 critères une fois complets", () => {
  const details = {
    roa_positif: 1, cfo_positif: 1, roa_croissant: 0, qualite_accruals: 1, levier_baisse: 0,
    liquidite_hausse: 1, pas_dilution: 1, marge_brute_hausse: 0, rotation_actifs_hausse: 1,
  };
  assert.equal(computeFScoreFromDetails(details), 6);
});

test("computeScore: le détail F-Score complet prime sur le F-Score manuel", () => {
  const details = {
    roa_positif: 1, cfo_positif: 1, roa_croissant: 1, qualite_accruals: 1, levier_baisse: 1,
    liquidite_hausse: 1, pas_dilution: 1, marge_brute_hausse: 1, rotation_actifs_hausse: 1,
  };
  const row = { marge_securite_vis: 45, f_score: 2, fscore_details: details, z_score: 3.5, dette_ebitda: 0.5, roe: 20, rendement_dividende: 4 };
  const result = computeScore(row, WEIGHTS, THRESHOLDS);
  assert.equal(result.rawValues.f_score, 9);
});

test("median: pair et impair", () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test("sectorStats: médiane seulement à partir de 2 valeurs par secteur", () => {
  const watchlist = [
    { secteur: "Santé", per: 20, pb: 3 },
    { secteur: "Santé", per: 30, pb: null },
    { secteur: "Tech", per: 40, pb: 5 },
  ];
  const stats = sectorStats(watchlist);
  assert.equal(stats["Santé"].per_median, 25);
  assert.equal(stats["Santé"].pb_median, null); // une seule valeur de P/B dans le secteur
  assert.equal(stats["Tech"].per_median, null); // un seul titre dans le secteur
});
