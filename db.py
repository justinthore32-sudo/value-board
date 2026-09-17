"""
Couche d'accès aux données (SQLite) pour ValueBoard.

Toutes les données sont saisies manuellement par l'utilisateur (aucun appel
réseau, aucune clé API). La base est stockée dans data/value_board.db et
n'est jamais versionnée dans git (voir .gitignore).
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import pandas as pd
import streamlit as st

DB_PATH = Path(__file__).parent / "data" / "value_board.db"

STATUTS = ["À surveiller", "Analyse en cours", "Acheté", "Rejeté"]

# ---------------------------------------------------------------- réglages
DEFAULT_WEIGHTS = {
    "marge_securite": 25,
    "f_score": 20,
    "z_score": 15,
    "dette_ebitda": 15,  # inversé : plus bas = mieux
    "roe": 15,
    "dividende": 10,
}

DEFAULT_THRESHOLDS = {
    "marge_securite_opportunite": 30.0,   # % au-dessus de laquelle on signale une opportunité
    "f_score_alerte": 4,                  # en dessous : qualité faible
    "dette_ebitda_alerte": 3.0,           # au-dessus : risque bilanciel
    "z_score_detresse": 1.81,
    "z_score_sain": 2.99,
    "verdict_achat_fort": 75.0,           # score >= : "Achat fort"
    "verdict_surveiller": 50.0,           # score >= : "À surveiller"
    "delai_revue_jours": 0,               # 0 = alerte dès que la date de revue est dépassée
}

DEFAULT_CHECKLIST_WEIGHT = 0  # poids du taux de réussite checklist dans le score (0 = non inclus)


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@st.cache_resource(show_spinner=False)
def get_connection() -> sqlite3.Connection:
    return _connect()


@contextmanager
def cursor():
    conn = get_connection()
    cur = conn.cursor()
    try:
        yield cur
        conn.commit()
    finally:
        cur.close()


def init_db() -> None:
    with cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS watchlist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                nom TEXT,
                secteur TEXT,
                statut TEXT DEFAULT 'À surveiller',
                prix_actuel REAL,
                devise TEXT DEFAULT 'EUR',
                per REAL,
                pb REAL,
                pcf REAL,
                rendement_dividende REAL,
                dette_ebitda REAL,
                roe REAL,
                f_score INTEGER,
                z_score REAL,
                marge_securite_vis REAL,
                croissance_estimee REAL,
                -- checklist Graham (critères qualitatifs, saisis à la main)
                taille_ok INTEGER,
                bilan_solide INTEGER,
                benefices_stables INTEGER,
                dividende_continu INTEGER,
                croissance_benefices INTEGER,
                notes TEXT,
                date_maj TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS theses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                watchlist_id INTEGER NOT NULL,
                these TEXT,
                catalyseurs TEXT,
                risques TEXT,
                date_revue TEXT,
                date_creation TEXT,
                FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS portefeuille (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                nom TEXT,
                quantite REAL,
                pru REAL,
                prix_actuel REAL,
                date_achat TEXT,
                notes TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS valorisations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                methode TEXT NOT NULL,
                parametres TEXT,
                valeur_intrinseque REAL,
                prix_actuel REAL,
                marge_securite REAL,
                date_calcul TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )

    # Initialise les réglages par défaut s'ils n'existent pas encore
    if get_setting("weights") is None:
        set_setting("weights", DEFAULT_WEIGHTS)
    if get_setting("thresholds") is None:
        set_setting("thresholds", DEFAULT_THRESHOLDS)
    if get_setting("checklist_weight") is None:
        set_setting("checklist_weight", DEFAULT_CHECKLIST_WEIGHT)


# ----------------------------------------------------------------- settings
def get_setting(key: str):
    conn = get_connection()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if row is None:
        return None
    return json.loads(row["value"])


def set_setting(key: str, value) -> None:
    with cursor() as cur:
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )


def get_weights() -> dict:
    return get_setting("weights") or DEFAULT_WEIGHTS


def get_thresholds() -> dict:
    return get_setting("thresholds") or DEFAULT_THRESHOLDS


def reset_settings() -> None:
    set_setting("weights", DEFAULT_WEIGHTS)
    set_setting("thresholds", DEFAULT_THRESHOLDS)
    set_setting("checklist_weight", DEFAULT_CHECKLIST_WEIGHT)


# ---------------------------------------------------------------- watchlist
def add_watchlist_row(data: dict) -> None:
    data = {**data, "date_maj": date.today().isoformat()}
    cols = ", ".join(data.keys())
    placeholders = ", ".join("?" for _ in data)
    with cursor() as cur:
        cur.execute(
            f"INSERT INTO watchlist ({cols}) VALUES ({placeholders})",
            tuple(data.values()),
        )


def update_watchlist_row(row_id: int, data: dict) -> None:
    data = {**data, "date_maj": date.today().isoformat()}
    set_clause = ", ".join(f"{k} = ?" for k in data)
    with cursor() as cur:
        cur.execute(
            f"UPDATE watchlist SET {set_clause} WHERE id = ?",
            (*data.values(), row_id),
        )


def delete_watchlist_row(row_id: int) -> None:
    with cursor() as cur:
        cur.execute("DELETE FROM watchlist WHERE id = ?", (row_id,))


def fetch_watchlist() -> pd.DataFrame:
    conn = get_connection()
    return pd.read_sql_query("SELECT * FROM watchlist ORDER BY date_maj DESC", conn)


# ------------------------------------------------------------------ theses
def add_these(data: dict) -> None:
    data = {**data, "date_creation": date.today().isoformat()}
    cols = ", ".join(data.keys())
    placeholders = ", ".join("?" for _ in data)
    with cursor() as cur:
        cur.execute(
            f"INSERT INTO theses ({cols}) VALUES ({placeholders})",
            tuple(data.values()),
        )


def fetch_theses(watchlist_id: int | None = None) -> pd.DataFrame:
    conn = get_connection()
    if watchlist_id is None:
        return pd.read_sql_query(
            """
            SELECT theses.*, watchlist.ticker, watchlist.nom
            FROM theses JOIN watchlist ON theses.watchlist_id = watchlist.id
            ORDER BY theses.date_creation DESC
            """,
            conn,
        )
    return pd.read_sql_query(
        "SELECT * FROM theses WHERE watchlist_id = ? ORDER BY date_creation DESC",
        conn,
        params=(watchlist_id,),
    )


def delete_these(these_id: int) -> None:
    with cursor() as cur:
        cur.execute("DELETE FROM theses WHERE id = ?", (these_id,))


# ------------------------------------------------------------- portefeuille
def add_position(data: dict) -> None:
    cols = ", ".join(data.keys())
    placeholders = ", ".join("?" for _ in data)
    with cursor() as cur:
        cur.execute(
            f"INSERT INTO portefeuille ({cols}) VALUES ({placeholders})",
            tuple(data.values()),
        )


def update_position(row_id: int, data: dict) -> None:
    set_clause = ", ".join(f"{k} = ?" for k in data)
    with cursor() as cur:
        cur.execute(
            f"UPDATE portefeuille SET {set_clause} WHERE id = ?",
            (*data.values(), row_id),
        )


def delete_position(row_id: int) -> None:
    with cursor() as cur:
        cur.execute("DELETE FROM portefeuille WHERE id = ?", (row_id,))


def fetch_portefeuille() -> pd.DataFrame:
    conn = get_connection()
    return pd.read_sql_query("SELECT * FROM portefeuille ORDER BY date_achat DESC", conn)


# ------------------------------------------------------------- valorisations
def add_valorisation(data: dict) -> None:
    data = {**data, "date_calcul": date.today().isoformat()}
    cols = ", ".join(data.keys())
    placeholders = ", ".join("?" for _ in data)
    with cursor() as cur:
        cur.execute(
            f"INSERT INTO valorisations ({cols}) VALUES ({placeholders})",
            tuple(data.values()),
        )


def fetch_valorisations(ticker: str | None = None) -> pd.DataFrame:
    conn = get_connection()
    if ticker:
        return pd.read_sql_query(
            "SELECT * FROM valorisations WHERE ticker = ? ORDER BY date_calcul DESC",
            conn,
            params=(ticker,),
        )
    return pd.read_sql_query(
        "SELECT * FROM valorisations ORDER BY date_calcul DESC", conn
    )


def latest_valorisation(ticker: str) -> dict | None:
    df = fetch_valorisations(ticker)
    if df.empty:
        return None
    return df.iloc[0].to_dict()
