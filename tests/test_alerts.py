"""Tests unitaires du moteur d'alertes (alerts.py) — un cas de test par seuil (§11)."""

from datetime import date, timedelta

import pandas as pd

from alerts import portfolio_alerts, watchlist_alerts
from db import DEFAULT_THRESHOLDS

THRESHOLDS = DEFAULT_THRESHOLDS


def _watchlist_row(**overrides):
    base = dict(
        id=1, ticker="ABC", nom="ABC Corp", secteur="Tech", statut="À surveiller",
        marge_securite_vis=None, f_score=None, dette_ebitda=None, z_score=None,
    )
    base.update(overrides)
    return pd.DataFrame([base])


def test_alerte_opportunite_se_declenche_au_dessus_du_seuil():
    wl = _watchlist_row(marge_securite_vis=35)
    alerts = watchlist_alerts(wl, THRESHOLDS)
    assert any(a["type"] == "Opportunité" and a["severity"] == "info" for a in alerts)


def test_alerte_opportunite_ne_se_declenche_pas_sous_le_seuil():
    wl = _watchlist_row(marge_securite_vis=10)
    alerts = watchlist_alerts(wl, THRESHOLDS)
    assert not any(a["type"] == "Opportunité" for a in alerts)


def test_alerte_qualite_faible_f_score():
    wl = _watchlist_row(f_score=2)
    alerts = watchlist_alerts(wl, THRESHOLDS)
    assert any(a["type"] == "Qualité faible" and a["severity"] == "warning" for a in alerts)


def test_alerte_dette_elevee():
    wl = _watchlist_row(dette_ebitda=4.0)
    alerts = watchlist_alerts(wl, THRESHOLDS)
    assert any(a["type"] == "Dette élevée" and a["severity"] == "warning" for a in alerts)


def test_alerte_detresse_financiere():
    wl = _watchlist_row(z_score=1.2)
    alerts = watchlist_alerts(wl, THRESHOLDS)
    assert any(a["type"] == "Détresse financière" and a["severity"] == "critical" for a in alerts)


def test_aucune_alerte_watchlist_si_rien_ne_franchit_les_seuils():
    wl = _watchlist_row(marge_securite_vis=5, f_score=8, dette_ebitda=0.5, z_score=3.5)
    assert watchlist_alerts(wl, THRESHOLDS) == []


def test_alerte_objectif_prix_atteint():
    portefeuille = pd.DataFrame([dict(id=1, ticker="ABC", nom="ABC Corp", prix_actuel=120)])
    watchlist = pd.DataFrame(columns=["id", "ticker"])
    theses = pd.DataFrame(columns=["watchlist_id", "date_revue"])
    valorisations = pd.DataFrame([
        dict(ticker="ABC", methode="Graham Number", valeur_intrinseque=100, date_calcul="2026-01-01")
    ])
    alerts = portfolio_alerts(portefeuille, watchlist, theses, valorisations, THRESHOLDS)
    assert any(a["type"] == "Objectif de prix atteint" and a["severity"] == "warning" for a in alerts)


def test_pas_alerte_objectif_prix_si_sous_la_valeur_intrinseque():
    portefeuille = pd.DataFrame([dict(id=1, ticker="ABC", nom="ABC Corp", prix_actuel=80)])
    watchlist = pd.DataFrame(columns=["id", "ticker"])
    theses = pd.DataFrame(columns=["watchlist_id", "date_revue"])
    valorisations = pd.DataFrame([
        dict(ticker="ABC", methode="Graham Number", valeur_intrinseque=100, date_calcul="2026-01-01")
    ])
    alerts = portfolio_alerts(portefeuille, watchlist, theses, valorisations, THRESHOLDS)
    assert not any(a["type"] == "Objectif de prix atteint" for a in alerts)


def test_alerte_revue_these_en_retard():
    portefeuille = pd.DataFrame([dict(id=1, ticker="ABC", nom="ABC Corp", prix_actuel=None)])
    watchlist = pd.DataFrame([dict(id=1, ticker="ABC")])
    hier = (date.today() - timedelta(days=3)).isoformat()
    theses = pd.DataFrame([dict(watchlist_id=1, date_revue=hier, date_creation=hier)])
    valorisations = pd.DataFrame(columns=["ticker", "valeur_intrinseque"])
    alerts = portfolio_alerts(portefeuille, watchlist, theses, valorisations, THRESHOLDS)
    assert any(a["type"] == "Revue de thèse en retard" and a["severity"] == "critical" for a in alerts)


def test_pas_alerte_revue_these_si_date_future():
    portefeuille = pd.DataFrame([dict(id=1, ticker="ABC", nom="ABC Corp", prix_actuel=None)])
    watchlist = pd.DataFrame([dict(id=1, ticker="ABC")])
    demain = (date.today() + timedelta(days=3)).isoformat()
    theses = pd.DataFrame([dict(watchlist_id=1, date_revue=demain, date_creation=demain)])
    valorisations = pd.DataFrame(columns=["ticker", "valeur_intrinseque"])
    alerts = portfolio_alerts(portefeuille, watchlist, theses, valorisations, THRESHOLDS)
    assert not any(a["type"] == "Revue de thèse en retard" for a in alerts)
