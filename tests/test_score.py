"""Tests unitaires du moteur de scoring (score.py) — sans dépendance à Streamlit/SQLite."""

from db import DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS
from score import checklist_pass_rate, checklist_status, compute_score, normalize_metric, verdict_label

THRESHOLDS = DEFAULT_THRESHOLDS
WEIGHTS = DEFAULT_WEIGHTS


def test_normalize_metric_missing_returns_none():
    assert normalize_metric("marge_securite", None, THRESHOLDS) is None
    assert normalize_metric("f_score", float("nan"), THRESHOLDS) is None


def test_normalize_metric_clips_out_of_range():
    assert normalize_metric("marge_securite", 100, THRESHOLDS) == 100  # clip haut
    assert normalize_metric("marge_securite", -10, THRESHOLDS) == 0  # clip bas


def test_normalize_metric_dette_ebitda_is_inverted():
    assert normalize_metric("dette_ebitda", 0, THRESHOLDS) == 100
    assert normalize_metric("dette_ebitda", 5, THRESHOLDS) == 0
    assert normalize_metric("dette_ebitda", 10, THRESHOLDS) == 0  # clip


def test_normalize_metric_z_score_interpolation():
    assert normalize_metric("z_score", 1.81, THRESHOLDS) == 0.0
    assert normalize_metric("z_score", 2.99, THRESHOLDS) == 100.0
    milieu = normalize_metric("z_score", (1.81 + 2.99) / 2, THRESHOLDS)
    assert 49 < milieu < 51


def test_compute_score_titre_complet_achat_fort():
    row = dict(
        marge_securite_vis=45, f_score=8, z_score=3.5,
        dette_ebitda=0.5, roe=20, rendement_dividende=4,
    )
    result = compute_score(row, WEIGHTS, THRESHOLDS)
    assert result["score"] is not None
    assert result["coverage"] == 6
    assert result["verdict"] == "Achat fort"


def test_compute_score_metriques_manquantes_non_penalisees():
    row = dict(
        marge_securite_vis=45, f_score=None, z_score=None,
        dette_ebitda=None, roe=None, rendement_dividende=None,
    )
    result = compute_score(row, WEIGHTS, THRESHOLDS)
    assert result["coverage"] == 1
    assert result["score"] == 90.0  # seule métrique dispo = marge de sécurité (45/50*100)


def test_compute_score_aucune_metrique_disponible():
    row = dict(
        marge_securite_vis=None, f_score=None, z_score=None,
        dette_ebitda=None, roe=None, rendement_dividende=None,
    )
    result = compute_score(row, WEIGHTS, THRESHOLDS)
    assert result["score"] is None
    assert result["verdict"] == "Données insuffisantes"


def test_compute_score_titre_en_detresse_financiere():
    row = dict(
        marge_securite_vis=10, f_score=3, z_score=1.0,
        dette_ebitda=4.5, roe=2, rendement_dividende=0,
    )
    result = compute_score(row, WEIGHTS, THRESHOLDS)
    assert result["sub_scores"]["z_score"] == 0.0
    assert result["verdict"] == "Écarter"


def test_verdict_label_thresholds():
    assert verdict_label(75, THRESHOLDS) == "Achat fort"
    assert verdict_label(74.9, THRESHOLDS) == "À surveiller"
    assert verdict_label(50, THRESHOLDS) == "À surveiller"
    assert verdict_label(49.9, THRESHOLDS) == "Écarter"
    assert verdict_label(None, THRESHOLDS) == "Données insuffisantes"


def test_checklist_auto_per_modere():
    row = dict(per=12, pb=1.0)
    statuses = {s["key"]: s["value"] for s in checklist_status(row)}
    assert statuses["per_modere"] is True
    assert statuses["valorisation_moderee"] is True  # pb <= 1.5


def test_checklist_auto_missing_data_is_none():
    row = dict(per=None, pb=None)
    statuses = {s["key"]: s["value"] for s in checklist_status(row)}
    assert statuses["per_modere"] is None
    assert statuses["valorisation_moderee"] is None


def test_checklist_pass_rate_ignores_unknown():
    row = dict(
        taille_ok=1, bilan_solide=0, benefices_stables=None,
        dividende_continu=None, croissance_benefices=None,
        per=20, pb=3,  # per_modere False, valorisation_moderee False (20*3=60>22.5, pb=3>1.5)
    )
    passed, known = checklist_pass_rate(row)
    assert known == 4  # taille_ok, bilan_solide, per_modere, valorisation_moderee connus
    assert passed == 1  # seul taille_ok est vrai
