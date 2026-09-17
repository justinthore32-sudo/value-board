"""
Tests d'intégration via le harnais officiel streamlit.testing.v1.AppTest (§11 du
cahier des charges) : chaque page doit démarrer sans exception, en base vide puis
avec un jeu de données couvrant les scénarios clés (titre "Achat fort" complet,
titre avec métriques manquantes, titre en détresse financière, position avec
objectif de prix atteint, thèse en retard de revue).
"""

from datetime import date, timedelta
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

import db

ROOT = Path(__file__).parent.parent

ALL_SCRIPTS = [
    "app.py",
    "pages/1_Watchlist.py",
    "pages/2_Fiche_Titre.py",
    "pages/3_Comparateur.py",
    "pages/4_Alertes.py",
    "pages/5_Portefeuille.py",
    "pages/6_Journal.py",
    "pages/7_Reglages.py",
]


@pytest.fixture()
def isolated_db(tmp_path, monkeypatch):
    """Redirige db.DB_PATH vers un fichier temporaire isolé pour chaque test."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test_value_board.db")
    db.get_connection.clear()  # st.cache_resource : vider le cache lié à l'ancien chemin
    db.init_db()
    yield
    db.get_connection.clear()


def _run(script: str) -> AppTest:
    at = AppTest.from_file(str(ROOT / script))
    at.run()
    return at


# ------------------------------------------------------------------- base vide
@pytest.mark.parametrize("script", ALL_SCRIPTS)
def test_page_starts_without_exception_on_empty_db(isolated_db, script):
    at = _run(script)
    assert not at.exception


# --------------------------------------------------------- jeu de données test
def _seed_scenarios():
    """Peuple la base avec les scénarios recommandés par le cahier des charges (§11)."""
    # 1. Titre "Achat fort" complet
    db.add_watchlist_row(dict(
        ticker="FORT", nom="Achat Fort SA", secteur="Industrie", statut="À surveiller",
        prix_actuel=50.0, devise="EUR", per=10, pb=1.2, pcf=8,
        rendement_dividende=4.0, dette_ebitda=0.5, roe=20, f_score=8, z_score=3.5,
        marge_securite_vis=40, croissance_estimee=6,
        taille_ok=1, bilan_solide=1, benefices_stables=1, dividende_continu=1, croissance_benefices=1,
        notes="",
    ))
    # 2. Titre avec métriques manquantes
    db.add_watchlist_row(dict(
        ticker="PARTIEL", nom="Données Partielles SA", secteur="Santé", statut="Analyse en cours",
        prix_actuel=20.0, devise="EUR", per=None, pb=None, pcf=None,
        rendement_dividende=None, dette_ebitda=None, roe=None, f_score=None, z_score=None,
        marge_securite_vis=25, croissance_estimee=None,
        taille_ok=None, bilan_solide=None, benefices_stables=None, dividende_continu=None, croissance_benefices=None,
        notes="",
    ))
    # 3. Titre en détresse financière (Z-Score bas)
    db.add_watchlist_row(dict(
        ticker="DETRESSE", nom="Détresse SA", secteur="Énergie", statut="À surveiller",
        prix_actuel=5.0, devise="EUR", per=30, pb=4, pcf=15,
        rendement_dividende=0, dette_ebitda=6.0, roe=-5, f_score=2, z_score=1.0,
        marge_securite_vis=-10, croissance_estimee=-2,
        taille_ok=0, bilan_solide=0, benefices_stables=0, dividende_continu=0, croissance_benefices=0,
        notes="",
    ))

    # 4. Position de portefeuille avec objectif de prix atteint
    db.add_position(dict(
        ticker="FORT", nom="Achat Fort SA", quantite=10, pru=40.0,
        prix_actuel=55.0, date_achat="2025-01-15", notes="",
    ))
    db.add_valorisation(dict(
        ticker="FORT", methode="Graham Number", parametres="BPA=5; VCPA=45",
        valeur_intrinseque=50.0, prix_actuel=55.0, marge_securite=-10.0,
    ))

    # 5. Thèse en retard de revue (liée au titre en détresse)
    wl = db.fetch_watchlist()
    detresse_id = int(wl[wl["ticker"] == "DETRESSE"].iloc[0]["id"])
    en_retard = (date.today() - timedelta(days=10)).isoformat()
    db.add_these(dict(
        watchlist_id=detresse_id, these="Thèse test", catalyseurs="—", risques="—",
        date_revue=en_retard,
    ))
    db.add_position(dict(
        ticker="DETRESSE", nom="Détresse SA", quantite=100, pru=8.0,
        prix_actuel=5.0, date_achat="2024-06-01", notes="",
    ))


@pytest.mark.parametrize("script", ALL_SCRIPTS)
def test_page_starts_without_exception_with_data(isolated_db, script):
    _seed_scenarios()
    at = _run(script)
    assert not at.exception


def test_accueil_kpis_reflete_les_donnees(isolated_db):
    _seed_scenarios()
    at = _run("app.py")
    assert not at.exception
    metrics = {m.label: m.value for m in at.metric}
    assert metrics["Titres suivis"] == "3"
    assert metrics["Achats forts"] == "1"
    assert metrics["Positions en portefeuille"] == "2"


def test_alertes_page_detecte_les_quatre_seuils_watchlist_et_les_deux_portefeuille(isolated_db):
    _seed_scenarios()
    at = _run("pages/4_Alertes.py")
    assert not at.exception
    texte = " ".join(m.value for m in at.markdown)
    # watchlist : opportunité (FORT), qualité faible + dette élevée + détresse (DETRESSE)
    assert "Opportunité" in texte
    assert "Qualité faible" in texte
    assert "Dette élevée" in texte
    assert "Détresse financière" in texte
    # portefeuille : objectif de prix atteint (FORT) + revue en retard (DETRESSE)
    assert "Objectif de prix atteint" in texte
    assert "Revue de thèse en retard" in texte


def test_watchlist_export_csv_inclut_score_et_verdict(isolated_db):
    # L'export CSV réutilise df_scored tel quel (voir pages/1_Watchlist.py) : on
    # vérifie donc que le score/verdict calculés sont bien présents dans les
    # données affichées, qui sont la source exacte du fichier exporté (le
    # contenu binaire du download_button n'est pas exposé par AppTest en mode bare).
    _seed_scenarios()
    at = _run("pages/1_Watchlist.py")
    assert not at.exception
    assert at.get("download_button")  # le bouton d'export est bien présent
    colonnes = at.dataframe[0].value.columns.tolist()
    assert "Score" in colonnes
    assert "Verdict" in colonnes


# --------------------------------------------------- garde-fou DCF (§7.3 / §10)
def test_dcf_refuse_taux_actualisation_inferieur_ou_egal_a_la_croissance_terminale(isolated_db):
    db.add_watchlist_row(dict(
        ticker="DCF1", nom="DCF Test SA", secteur="Tech", statut="Analyse en cours",
        prix_actuel=30.0, devise="EUR",
    ))
    row_id = int(db.fetch_watchlist().iloc[0]["id"])

    at = _run("pages/2_Fiche_Titre.py")
    at.radio(key=f"methode_{row_id}").set_value("DCF simplifié")
    at.run()

    at.number_input(key=f"fcf_{row_id}").set_value(100.0)
    at.number_input(key=f"nbact_{row_id}").set_value(10.0)
    at.number_input(key=f"taux_{row_id}").set_value(1.0)   # <= croissance terminale (2.0 par défaut)
    at.button(key=f"calc_dcf_{row_id}").click()
    at.run()

    assert not at.exception
    assert len(at.error) >= 1
    assert db.fetch_valorisations("DCF1").empty  # aucun calcul aberrant enregistré
