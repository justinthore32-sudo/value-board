// Tests unitaires du moteur de scoring — port direct de l'ancienne suite Python (test_score.py).
// Lancer avec : node --test docs/js

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeMetric, computeScore, verdictLabel, checklistStatus, checklistPassRate,
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
