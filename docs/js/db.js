/* Couche de données pour Margin — synchronisée avec le Worker Cloudflare
   (voir api.js). Un cache mémoire est chargé une fois par page via
   `await db.sync()`, puis toutes les lectures/écritures se font dessus ;
   chaque écriture renvoie l'intégralité du blob au Worker en arrière-plan
   (pas besoin d'attendre ce renvoi pour que l'UI se mette à jour). */

const STATUTS = ["À surveiller", "Analyse en cours", "Acheté", "Rejeté"];

const DEFAULT_WEIGHTS = {
  marge_securite: 25,
  f_score: 20,
  z_score: 15,
  dette_ebitda: 15,
  roe: 15,
  dividende: 10,
};

const DEFAULT_THRESHOLDS = {
  marge_securite_opportunite: 30.0,
  f_score_alerte: 4,
  dette_ebitda_alerte: 3.0,
  z_score_detresse: 1.81,
  z_score_sain: 2.99,
  verdict_achat_fort: 75.0,
  verdict_surveiller: 50.0,
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function _emptyStore() {
  return {
    watchlist: [],
    portefeuille: [],
    theses: [],
    valorisations: [],
    settings: {
      weights: { ...DEFAULT_WEIGHTS },
      thresholds: { ...DEFAULT_THRESHOLDS },
    },
    nextIds: { watchlist: 1, portefeuille: 1, theses: 1, valorisations: 1 },
  };
}

let _cache = null;

function _normalize(data) {
  data.settings = data.settings || { weights: { ...DEFAULT_WEIGHTS }, thresholds: { ...DEFAULT_THRESHOLDS } };
  data.settings.weights = data.settings.weights || { ...DEFAULT_WEIGHTS };
  data.settings.thresholds = data.settings.thresholds || { ...DEFAULT_THRESHOLDS };
  data.nextIds = data.nextIds || { watchlist: 1, portefeuille: 1, theses: 1, valorisations: 1 };
  data.watchlist = (data.watchlist || []).map((row) => ({ historique: [], ...row }));
  data.portefeuille = data.portefeuille || [];
  data.theses = data.theses || [];
  data.valorisations = data.valorisations || [];
  return data;
}

function _persist() {
  apiPut("/api/data", _cache).catch((err) => {
    window.dispatchEvent(new CustomEvent("valueboard-sync-error", { detail: err.message }));
  });
}

/* Champs dont la variation déclenche un nouveau point d'historique — le
   statut/notes/date n'en font pas partie, seules les métriques qui entrent
   dans le score ont un intérêt à être suivies dans le temps. */
const TRACKED_METRIC_FIELDS = [
  "prix_actuel", "per", "pb", "roe", "dette_ebitda", "f_score", "z_score", "marge_securite_vis",
  "zscore_modele", "fscore_details",
];

function snapshotMetrics(row) {
  const weights = db.getWeights();
  const thresholds = db.getThresholds();
  const result = computeScore(row, weights, thresholds);
  return {
    date: todayISO(),
    prix_actuel: row.prix_actuel ?? null,
    per: row.per ?? null,
    pb: row.pb ?? null,
    roe: row.roe ?? null,
    dette_ebitda: row.dette_ebitda ?? null,
    f_score: row.f_score ?? null,
    z_score: row.z_score ?? null,
    marge_securite_vis: row.marge_securite_vis ?? null,
    score: result.score,
    verdict: result.verdict,
  };
}

const db = {
  async sync() {
    const data = await apiGet("/api/data");
    _cache = _normalize(data || _emptyStore());
    return _cache;
  },

  // ---------------------------------------------------------------- watchlist
  fetchWatchlist() {
    return [..._cache.watchlist].sort((a, b) => (b.date_maj || "").localeCompare(a.date_maj || ""));
  },
  addWatchlistRow(row) {
    const id = _cache.nextIds.watchlist++;
    const full = { id, historique: [], ...row, date_maj: todayISO() };
    full.historique = [snapshotMetrics(full)];
    _cache.watchlist.push(full);
    _persist();
    return id;
  },
  updateWatchlistRow(id, patch) {
    const idx = _cache.watchlist.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const updated = { ..._cache.watchlist[idx], ...patch, date_maj: todayISO() };
    const metricChanged = Object.keys(patch).some((k) => TRACKED_METRIC_FIELDS.includes(k));
    if (metricChanged) {
      updated.historique = [...(updated.historique || []), snapshotMetrics(updated)];
    }
    _cache.watchlist[idx] = updated;
    _persist();
  },
  deleteWatchlistRow(id) {
    _cache.watchlist = _cache.watchlist.filter((r) => r.id !== id);
    _persist();
  },

  // ------------------------------------------------------------------ theses
  fetchTheses(watchlistId = null) {
    let rows = _cache.theses;
    if (watchlistId != null) {
      rows = rows.filter((t) => t.watchlist_id === watchlistId);
    } else {
      rows = rows.map((t) => {
        const wl = _cache.watchlist.find((w) => w.id === t.watchlist_id);
        return { ...t, ticker: wl ? wl.ticker : "?", nom: wl ? wl.nom : "" };
      });
    }
    return [...rows].sort((a, b) => (b.date_creation || "").localeCompare(a.date_creation || ""));
  },
  addThese(row) {
    const id = _cache.nextIds.theses++;
    _cache.theses.push({ id, ...row, date_creation: todayISO() });
    _persist();
    return id;
  },
  deleteThese(id) {
    _cache.theses = _cache.theses.filter((t) => t.id !== id);
    _persist();
  },

  // ------------------------------------------------------------- portefeuille
  fetchPortefeuille() {
    return [..._cache.portefeuille].sort((a, b) => (b.date_achat || "").localeCompare(a.date_achat || ""));
  },
  addPosition(row) {
    const id = _cache.nextIds.portefeuille++;
    _cache.portefeuille.push({ id, ...row });
    _persist();
    return id;
  },
  updatePosition(id, patch) {
    const idx = _cache.portefeuille.findIndex((r) => r.id === id);
    if (idx === -1) return;
    _cache.portefeuille[idx] = { ..._cache.portefeuille[idx], ...patch };
    _persist();
  },
  deletePosition(id) {
    _cache.portefeuille = _cache.portefeuille.filter((r) => r.id !== id);
    _persist();
  },

  // ------------------------------------------------------------ valorisations
  fetchValorisations(ticker = null) {
    let rows = _cache.valorisations;
    if (ticker) rows = rows.filter((v) => v.ticker === ticker);
    return [...rows].sort((a, b) => (b.date_calcul || "").localeCompare(a.date_calcul || ""));
  },
  addValorisation(row) {
    const id = _cache.nextIds.valorisations++;
    _cache.valorisations.push({ id, ...row, date_calcul: todayISO() });
    _persist();
    return id;
  },
  latestValorisation(ticker) {
    const rows = db.fetchValorisations(ticker);
    return rows.length ? rows[0] : null;
  },

  // ----------------------------------------------------------------settings
  getWeights() {
    return { ..._cache.settings.weights };
  },
  getThresholds() {
    return { ..._cache.settings.thresholds };
  },
  setSetting(key, value) {
    _cache.settings[key] = value;
    _persist();
  },
  resetSettings() {
    _cache.settings = { weights: { ...DEFAULT_WEIGHTS }, thresholds: { ...DEFAULT_THRESHOLDS } };
    _persist();
  },

  // ------------------------------------------------------------------ export
  exportAll() {
    return JSON.parse(JSON.stringify(_cache));
  },
};
