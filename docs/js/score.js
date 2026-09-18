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

/* Le Z-Score d'Altman a plusieurs variantes selon le type d'entreprise — les
   seuils originaux (1,81/2,99) ne sont fiables que pour une manufacturière
   cotée. "original" reste piloté par les seuils personnalisables des
   Réglages (comportement historique, inchangé) ; les deux autres modèles
   utilisent leurs seuils de référence fixes, propres à leur formule. */
const ZSCORE_MODELS = {
  original: { label: "Original (manufacturier coté)" },
  prive: { label: "Z′ (entreprise privée)", detresse: 1.23, sain: 2.90 },
  em_service: { label: "Z″ (non-manufacturier / marché émergent)", detresse: 1.10, sain: 2.60 },
};

function resolveZScoreThresholds(zscoreModele, thresholds) {
  const model = zscoreModele && zscoreModele !== "original" ? ZSCORE_MODELS[zscoreModele] : null;
  if (model) return { detresse: model.detresse, sain: model.sain };
  return { detresse: thresholds.z_score_detresse ?? 1.81, sain: thresholds.z_score_sain ?? 2.99 };
}

const FSCORE_CRITERIA = [
  ["roa_positif", "ROA positif"],
  ["cfo_positif", "Cash-flow opérationnel positif"],
  ["roa_croissant", "ROA en hausse sur l'exercice"],
  ["qualite_accruals", "CFO > résultat net (qualité des bénéfices)"],
  ["levier_baisse", "Endettement long terme en baisse"],
  ["liquidite_hausse", "Ratio de liquidité générale en hausse"],
  ["pas_dilution", "Pas de nouvelle émission d'actions"],
  ["marge_brute_hausse", "Marge brute en hausse"],
  ["rotation_actifs_hausse", "Rotation des actifs en hausse"],
];

// Ne calcule un F-Score qu'à partir d'un détail complet (9/9 critères
// renseignés) — un décompte partiel ne serait pas comparable à un vrai score
// Piotroski. Sinon on laisse la place au F-Score saisi manuellement.
function computeFScoreFromDetails(details) {
  if (!details) return null;
  const keys = FSCORE_CRITERIA.map(([k]) => k);
  if (!keys.every((k) => details[k] !== undefined && details[k] !== null)) return null;
  return keys.reduce((sum, k) => sum + (Number(details[k]) ? 1 : 0), 0);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Médiane PER/P-B par secteur, à partir de la propre watchlist de
// l'utilisateur (pas d'API externe) — s'ajoute aux critères Graham absolus
// sans les remplacer. Nécessite au moins 2 valeurs pour être affichée : une
// "médiane" sur un seul titre n'a pas de sens.
function sectorStats(watchlist) {
  const bySecteur = {};
  for (const row of watchlist) {
    if (!row.secteur) continue;
    const bucket = (bySecteur[row.secteur] = bySecteur[row.secteur] || { per: [], pb: [] });
    if (isNum(row.per)) bucket.per.push(Number(row.per));
    if (isNum(row.pb)) bucket.pb.push(Number(row.pb));
  }
  const stats = {};
  for (const [secteur, vals] of Object.entries(bySecteur)) {
    stats[secteur] = {
      per_median: vals.per.length >= 2 ? median(vals.per) : null,
      pb_median: vals.pb.length >= 2 ? median(vals.pb) : null,
    };
  }
  return stats;
}

function clip(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function isNum(value) {
  if (value === null || value === undefined || value === "") return false;
  return !Number.isNaN(Number(value));
}

function normalizeMetric(name, value, thresholds, zscoreModele) {
  if (!isNum(value)) return null;
  const v = Number(value);

  if (name === "marge_securite") return clip((v / 50) * 100, 0, 100);
  if (name === "f_score") return clip((v / 9) * 100, 0, 100);
  if (name === "z_score") {
    const { detresse: lo, sain: hi } = resolveZScoreThresholds(zscoreModele, thresholds);
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
  const fscoreFromDetails = computeFScoreFromDetails(row.fscore_details);
  const rawValues = {
    marge_securite: row.marge_securite_vis,
    f_score: fscoreFromDetails !== null ? fscoreFromDetails : row.f_score,
    z_score: row.z_score,
    dette_ebitda: row.dette_ebitda,
    roe: row.roe,
    dividende: row.rendement_dividende,
  };

  const subScores = {};
  for (const name of Object.keys(rawValues)) {
    subScores[name] = normalizeMetric(name, rawValues[name], thresholds, row.zscore_modele);
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
    ZSCORE_MODELS, resolveZScoreThresholds, FSCORE_CRITERIA, computeFScoreFromDetails,
    median, sectorStats,
    clip, isNum, normalizeMetric, computeScore, verdictLabel,
    checklistStatus, checklistPassRate,
  };
}
