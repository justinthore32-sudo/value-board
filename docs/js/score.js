/* Moteur de scoring — port direct de score.py. Mêmes formules, mêmes seuils. */

const METRIC_LABELS = {
  marge_securite: "Marge de sécurité",
  f_score: "Piotroski F-Score",
  z_score: "Altman Z-Score",
  dette_ebitda: "Dette / EBITDA",
  roe: "ROE",
  dividende: "Rendement dividende",
};

const VERDICT_COLORS = {
  "Achat fort": "#0ca30c",
  "À surveiller": "#eda100",
  "Écarter": "#d03b3b",
  "Données insuffisantes": "#898781",
};

const CHECKLIST_ITEMS = [
  ["taille_ok", "Taille adéquate", "manuel", "Chiffre d'affaires / capitalisation suffisants pour une entreprise établie."],
  ["bilan_solide", "Situation financière solide", "manuel", "Actifs courants ≥ 2x passifs courants (ratio de liquidité générale)."],
  ["benefices_stables", "Stabilité des bénéfices", "manuel", "Bénéfices positifs sur les 10 dernières années."],
  ["dividende_continu", "Historique de dividende", "manuel", "Dividende versé sans interruption sur longue période."],
  ["croissance_benefices", "Croissance des bénéfices", "manuel", "Bénéfice par action en hausse d'au moins ~33% sur 10 ans."],
  ["per_modere", "PER modéré", "auto", "PER ≤ 15."],
  ["valorisation_moderee", "Valorisation modérée", "auto", "PER × P/B ≤ 22,5, ou P/B ≤ 1,5."],
];

function clip(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function isNum(value) {
  if (value === null || value === undefined || value === "") return false;
  return !Number.isNaN(Number(value));
}

function normalizeMetric(name, value, thresholds) {
  if (!isNum(value)) return null;
  const v = Number(value);

  if (name === "marge_securite") return clip((v / 50) * 100, 0, 100);
  if (name === "f_score") return clip((v / 9) * 100, 0, 100);
  if (name === "z_score") {
    const lo = thresholds.z_score_detresse ?? 1.81;
    const hi = thresholds.z_score_sain ?? 2.99;
    if (v <= lo) return 0;
    if (v >= hi) return 100;
    return clip(((v - lo) / (hi - lo)) * 100, 0, 100);
  }
  if (name === "dette_ebitda") return clip(100 - (v / 5) * 100, 0, 100);
  if (name === "roe") return clip((v / 25) * 100, 0, 100);
  if (name === "dividende") return clip((v / 6) * 100, 0, 100);
  return null;
}

function computeScore(row, weights, thresholds) {
  const rawValues = {
    marge_securite: row.marge_securite_vis,
    f_score: row.f_score,
    z_score: row.z_score,
    dette_ebitda: row.dette_ebitda,
    roe: row.roe,
    dividende: row.rendement_dividende,
  };

  const subScores = {};
  for (const name of Object.keys(rawValues)) {
    subScores[name] = normalizeMetric(name, rawValues[name], thresholds);
  }

  let totalWeight = 0;
  let weightedSum = 0;
  for (const name of Object.keys(subScores)) {
    const w = Number(weights[name] || 0);
    if (subScores[name] !== null && w > 0) {
      weightedSum += subScores[name] * w;
      totalWeight += w;
    }
  }

  const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : null;
  const coverage = Object.values(subScores).filter((v) => v !== null).length;
  const verdict = verdictLabel(score, thresholds);

  return {
    score,
    verdict,
    subScores,
    rawValues,
    coverage,
    coverageTotal: Object.keys(rawValues).length,
  };
}

function verdictLabel(score, thresholds) {
  if (score === null) return "Données insuffisantes";
  const achatFort = thresholds.verdict_achat_fort ?? 75.0;
  const surveiller = thresholds.verdict_surveiller ?? 50.0;
  if (score >= achatFort) return "Achat fort";
  if (score >= surveiller) return "À surveiller";
  return "Écarter";
}

function checklistStatus(row) {
  return CHECKLIST_ITEMS.map(([key, label, kind, help]) => {
    let value;
    if (kind === "manuel") {
      const raw = row[key];
      value = raw === null || raw === undefined ? null : Boolean(Number(raw));
    } else if (key === "per_modere") {
      value = isNum(row.per) ? Number(row.per) <= 15 : null;
    } else if (key === "valorisation_moderee") {
      value = isNum(row.per) && isNum(row.pb)
        ? Number(row.per) * Number(row.pb) <= 22.5 || Number(row.pb) <= 1.5
        : null;
    } else {
      value = null;
    }
    return { key, label, kind, help, value };
  });
}

function checklistPassRate(row) {
  const statuses = checklistStatus(row);
  const known = statuses.filter((s) => s.value !== null);
  const passed = known.filter((s) => s.value === true);
  return [passed.length, known.length];
}

if (typeof module !== "undefined") {
  module.exports = {
    METRIC_LABELS, VERDICT_COLORS, CHECKLIST_ITEMS,
    clip, isNum, normalizeMetric, computeScore, verdictLabel,
    checklistStatus, checklistPassRate,
  };
}
