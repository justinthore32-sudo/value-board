/* Couche de données pour ValueBoard statique — remplace db.py.
   Toutes les données vivent dans localStorage, propres à ce navigateur/appareil
   (pas de synchronisation entre appareils, voir avertissement dans l'app). */

const STORAGE_KEY = "valueboard_data";

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

function _load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial = _emptyStore();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
  const parsed = JSON.parse(raw);
  parsed.settings = parsed.settings || { weights: { ...DEFAULT_WEIGHTS }, thresholds: { ...DEFAULT_THRESHOLDS } };
  parsed.settings.weights = parsed.settings.weights || { ...DEFAULT_WEIGHTS };
  parsed.settings.thresholds = parsed.settings.thresholds || { ...DEFAULT_THRESHOLDS };
  parsed.nextIds = parsed.nextIds || { watchlist: 1, portefeuille: 1, theses: 1, valorisations: 1 };
  return parsed;
}

function _save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const db = {
  // ---------------------------------------------------------------- watchlist
  fetchWatchlist() {
    return [..._load().watchlist].sort((a, b) => (b.date_maj || "").localeCompare(a.date_maj || ""));
  },
  addWatchlistRow(row) {
    const data = _load();
    const id = data.nextIds.watchlist++;
    data.watchlist.push({ id, ...row, date_maj: todayISO() });
    _save(data);
    return id;
  },
  updateWatchlistRow(id, patch) {
    const data = _load();
    const idx = data.watchlist.findIndex((r) => r.id === id);
    if (idx === -1) return;
    data.watchlist[idx] = { ...data.watchlist[idx], ...patch, date_maj: todayISO() };
    _save(data);
  },
  deleteWatchlistRow(id) {
    const data = _load();
    data.watchlist = data.watchlist.filter((r) => r.id !== id);
    _save(data);
  },

  // ------------------------------------------------------------------ theses
  fetchTheses(watchlistId = null) {
    const data = _load();
    let rows = data.theses;
    if (watchlistId != null) {
      rows = rows.filter((t) => t.watchlist_id === watchlistId);
    } else {
      rows = rows.map((t) => {
        const wl = data.watchlist.find((w) => w.id === t.watchlist_id);
        return { ...t, ticker: wl ? wl.ticker : "?", nom: wl ? wl.nom : "" };
      });
    }
    return [...rows].sort((a, b) => (b.date_creation || "").localeCompare(a.date_creation || ""));
  },
  addThese(row) {
    const data = _load();
    const id = data.nextIds.theses++;
    data.theses.push({ id, ...row, date_creation: todayISO() });
    _save(data);
    return id;
  },
  deleteThese(id) {
    const data = _load();
    data.theses = data.theses.filter((t) => t.id !== id);
    _save(data);
  },

  // ------------------------------------------------------------- portefeuille
  fetchPortefeuille() {
    return [..._load().portefeuille].sort((a, b) => (b.date_achat || "").localeCompare(a.date_achat || ""));
  },
  addPosition(row) {
    const data = _load();
    const id = data.nextIds.portefeuille++;
    data.portefeuille.push({ id, ...row });
    _save(data);
    return id;
  },
  updatePosition(id, patch) {
    const data = _load();
    const idx = data.portefeuille.findIndex((r) => r.id === id);
    if (idx === -1) return;
    data.portefeuille[idx] = { ...data.portefeuille[idx], ...patch };
    _save(data);
  },
  deletePosition(id) {
    const data = _load();
    data.portefeuille = data.portefeuille.filter((r) => r.id !== id);
    _save(data);
  },

  // ------------------------------------------------------------ valorisations
  fetchValorisations(ticker = null) {
    const data = _load();
    let rows = data.valorisations;
    if (ticker) rows = rows.filter((v) => v.ticker === ticker);
    return [...rows].sort((a, b) => (b.date_calcul || "").localeCompare(a.date_calcul || ""));
  },
  addValorisation(row) {
    const data = _load();
    const id = data.nextIds.valorisations++;
    data.valorisations.push({ id, ...row, date_calcul: todayISO() });
    _save(data);
    return id;
  },
  latestValorisation(ticker) {
    const rows = db.fetchValorisations(ticker);
    return rows.length ? rows[0] : null;
  },

  // ----------------------------------------------------------------settings
  getWeights() {
    return { ..._load().settings.weights };
  },
  getThresholds() {
    return { ..._load().settings.thresholds };
  },
  setSetting(key, value) {
    const data = _load();
    data.settings[key] = value;
    _save(data);
  },
  resetSettings() {
    const data = _load();
    data.settings = { weights: { ...DEFAULT_WEIGHTS }, thresholds: { ...DEFAULT_THRESHOLDS } };
    _save(data);
  },
};
