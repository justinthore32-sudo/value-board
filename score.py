"""
Moteur de scoring : transforme les métriques d'un titre en sous-scores
normalisés (0-100), un score composite pondéré, et un verdict.

Toutes les pondérations et tous les seuils viennent de db.get_weights() /
db.get_thresholds() — réglables dans la page Réglages. Rien n'est figé en dur
ici à part la façon dont chaque métrique brute est normalisée en 0-100.
"""

from __future__ import annotations

import math

METRIC_LABELS = {
    "marge_securite": "Marge de sécurité",
    "f_score": "Piotroski F-Score",
    "z_score": "Altman Z-Score",
    "dette_ebitda": "Dette / EBITDA",
    "roe": "ROE",
    "dividende": "Rendement dividende",
}


def _clip(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def is_num(value) -> bool:
    if value is None:
        return False
    try:
        return not math.isnan(float(value))
    except (TypeError, ValueError):
        return False


def normalize_metric(name: str, value, thresholds: dict) -> float | None:
    """Retourne un sous-score 0-100, ou None si la donnée est absente."""
    if not is_num(value):
        return None
    value = float(value)

    if name == "marge_securite":
        return _clip(value / 50.0 * 100, 0, 100)

    if name == "f_score":
        return _clip(value / 9.0 * 100, 0, 100)

    if name == "z_score":
        lo, hi = thresholds.get("z_score_detresse", 1.81), thresholds.get("z_score_sain", 2.99)
        if value <= lo:
            return 0.0
        if value >= hi:
            return 100.0
        return _clip((value - lo) / (hi - lo) * 100, 0, 100)

    if name == "dette_ebitda":
        # plus bas = mieux ; 0 (ou net cash) -> 100, >=5x -> 0
        return _clip(100 - (value / 5.0 * 100), 0, 100)

    if name == "roe":
        return _clip(value / 25.0 * 100, 0, 100)

    if name == "dividende":
        return _clip(value / 6.0 * 100, 0, 100)

    return None


def compute_score(row: dict, weights: dict, thresholds: dict) -> dict:
    """
    row : dict-like avec les clés marge_securite_vis, f_score, z_score,
    dette_ebitda, roe, rendement_dividende.
    """
    raw_values = {
        "marge_securite": row.get("marge_securite_vis"),
        "f_score": row.get("f_score"),
        "z_score": row.get("z_score"),
        "dette_ebitda": row.get("dette_ebitda"),
        "roe": row.get("roe"),
        "dividende": row.get("rendement_dividende"),
    }

    sub_scores = {
        name: normalize_metric(name, value, thresholds) for name, value in raw_values.items()
    }

    total_weight = 0.0
    weighted_sum = 0.0
    for name, sub in sub_scores.items():
        w = float(weights.get(name, 0) or 0)
        if sub is not None and w > 0:
            weighted_sum += sub * w
            total_weight += w

    score = round(weighted_sum / total_weight, 1) if total_weight > 0 else None
    coverage = sum(1 for v in sub_scores.values() if v is not None)

    verdict = verdict_label(score, thresholds)

    return {
        "score": score,
        "verdict": verdict,
        "sub_scores": sub_scores,
        "raw_values": raw_values,
        "coverage": coverage,
        "coverage_total": len(raw_values),
    }


def verdict_label(score: float | None, thresholds: dict) -> str:
    if score is None:
        return "Données insuffisantes"
    achat_fort = thresholds.get("verdict_achat_fort", 75.0)
    surveiller = thresholds.get("verdict_surveiller", 50.0)
    if score >= achat_fort:
        return "Achat fort"
    if score >= surveiller:
        return "À surveiller"
    return "Écarter"


VERDICT_COLORS = {
    "Achat fort": "#0ca30c",
    "À surveiller": "#eda100",
    "Écarter": "#d03b3b",
    "Données insuffisantes": "#898781",
}


# ---------------------------------------------------------- checklist Graham
CHECKLIST_ITEMS = [
    ("taille_ok", "Taille adéquate", "manuel", "Chiffre d'affaires / capitalisation suffisants pour une entreprise établie."),
    ("bilan_solide", "Situation financière solide", "manuel", "Actifs courants ≥ 2x passifs courants (ratio de liquidité générale)."),
    ("benefices_stables", "Stabilité des bénéfices", "manuel", "Bénéfices positifs sur les 10 dernières années."),
    ("dividende_continu", "Historique de dividende", "manuel", "Dividende versé sans interruption sur longue période."),
    ("croissance_benefices", "Croissance des bénéfices", "manuel", "Bénéfice par action en hausse d'au moins ~33% sur 10 ans."),
    ("per_modere", "PER modéré", "auto", "PER ≤ 15."),
    ("valorisation_moderee", "Valorisation modérée", "auto", "PER × P/B ≤ 22.5, ou P/B ≤ 1.5."),
]


def checklist_status(row: dict) -> list[dict]:
    """Retourne le statut (True/False/None) de chaque critère Graham pour ce titre."""
    results = []
    for key, label, kind, help_text in CHECKLIST_ITEMS:
        if kind == "manuel":
            raw = row.get(key)
            value = None if raw is None else bool(raw)
        elif key == "per_modere":
            per = row.get("per")
            value = (per is not None and is_num(per) and float(per) <= 15) if is_num(per) else None
        elif key == "valorisation_moderee":
            per, pb = row.get("per"), row.get("pb")
            if is_num(per) and is_num(pb):
                value = (float(per) * float(pb) <= 22.5) or (float(pb) <= 1.5)
            else:
                value = None
        else:
            value = None
        results.append({"key": key, "label": label, "kind": kind, "help": help_text, "value": value})
    return results


def checklist_pass_rate(row: dict) -> tuple[int, int]:
    statuses = checklist_status(row)
    known = [s for s in statuses if s["value"] is not None]
    passed = [s for s in known if s["value"] is True]
    return len(passed), len(known)
