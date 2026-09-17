"""
Moteur d'alertes : détecte les franchissements de seuils configurables,
sur la watchlist (opportunités / signaux de qualité) et sur le portefeuille
(risques de thèse, objectifs de prix atteints, revues en retard).
"""

from __future__ import annotations

from datetime import date

import pandas as pd

from score import is_num

SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}
SEVERITY_ICON = {"critical": "🔴", "warning": "🟠", "info": "🟢"}


def watchlist_alerts(watchlist: pd.DataFrame, thresholds: dict) -> list[dict]:
    alerts = []
    for row in watchlist.itertuples():
        ticker, nom = row.ticker, (row.nom or "")

        marge = getattr(row, "marge_securite_vis", None)
        if is_num(marge) and float(marge) >= thresholds.get("marge_securite_opportunite", 30.0):
            alerts.append(dict(
                ticker=ticker, nom=nom, categorie="Watchlist", severity="info",
                type="Opportunité",
                message=f"Marge de sécurité de {float(marge):.1f}% ≥ seuil ({thresholds.get('marge_securite_opportunite', 30.0):.0f}%).",
            ))

        f_score = getattr(row, "f_score", None)
        if is_num(f_score) and float(f_score) < thresholds.get("f_score_alerte", 4):
            alerts.append(dict(
                ticker=ticker, nom=nom, categorie="Watchlist", severity="warning",
                type="Qualité faible",
                message=f"Piotroski F-Score de {int(f_score)} < seuil ({int(thresholds.get('f_score_alerte', 4))}).",
            ))

        dette = getattr(row, "dette_ebitda", None)
        if is_num(dette) and float(dette) > thresholds.get("dette_ebitda_alerte", 3.0):
            alerts.append(dict(
                ticker=ticker, nom=nom, categorie="Watchlist", severity="warning",
                type="Dette élevée",
                message=f"Dette/EBITDA de {float(dette):.1f}x > seuil ({thresholds.get('dette_ebitda_alerte', 3.0):.1f}x).",
            ))

        z_score = getattr(row, "z_score", None)
        if is_num(z_score) and float(z_score) < thresholds.get("z_score_detresse", 1.81):
            alerts.append(dict(
                ticker=ticker, nom=nom, categorie="Watchlist", severity="critical",
                type="Détresse financière",
                message=f"Altman Z-Score de {float(z_score):.2f} sous le seuil de détresse ({thresholds.get('z_score_detresse', 1.81):.2f}).",
            ))

    return alerts


def portfolio_alerts(
    portefeuille: pd.DataFrame,
    watchlist: pd.DataFrame,
    theses: pd.DataFrame,
    valorisations: pd.DataFrame,
    thresholds: dict,
) -> list[dict]:
    alerts = []
    today = date.today()

    for row in portefeuille.itertuples():
        ticker, nom = row.ticker, (row.nom or "")
        prix_actuel = getattr(row, "prix_actuel", None)

        # Objectif de prix atteint : le prix actuel dépasse la dernière valeur intrinsèque calculée
        val_ticker = valorisations[valorisations["ticker"] == ticker]
        if not val_ticker.empty and is_num(prix_actuel):
            derniere = val_ticker.iloc[0]  # déjà trié par date décroissante
            vi = derniere.get("valeur_intrinseque")
            if is_num(vi) and float(prix_actuel) >= float(vi):
                alerts.append(dict(
                    ticker=ticker, nom=nom, categorie="Portefeuille", severity="warning",
                    type="Objectif de prix atteint",
                    message=(
                        f"Prix actuel ({float(prix_actuel):.2f}) ≥ dernière valeur intrinsèque "
                        f"calculée ({float(vi):.2f}, méthode {derniere.get('methode')}) — "
                        "à réévaluer."
                    ),
                ))

        # Revue de thèse en retard : cherche le titre correspondant dans la watchlist
        wl_match = watchlist[watchlist["ticker"] == ticker]
        if not wl_match.empty:
            wl_id = wl_match.iloc[0]["id"]
            th = theses[theses["watchlist_id"] == wl_id] if "watchlist_id" in theses.columns else pd.DataFrame()
            if not th.empty:
                derniere_revue = th.iloc[0].get("date_revue")
                if derniere_revue:
                    try:
                        d = date.fromisoformat(str(derniere_revue))
                        if d < today:
                            jours_retard = (today - d).days
                            alerts.append(dict(
                                ticker=ticker, nom=nom, categorie="Portefeuille", severity="critical",
                                type="Revue de thèse en retard",
                                message=f"Date de revue dépassée depuis {jours_retard} jour(s) ({d.isoformat()}).",
                            ))
                    except ValueError:
                        pass

    return alerts


def all_alerts(watchlist, portefeuille, theses, valorisations, thresholds) -> pd.DataFrame:
    items = watchlist_alerts(watchlist, thresholds) + portfolio_alerts(
        portefeuille, watchlist, theses, valorisations, thresholds
    )
    if not items:
        return pd.DataFrame(columns=["ticker", "nom", "categorie", "severity", "type", "message"])
    df = pd.DataFrame(items)
    df["ordre"] = df["severity"].map(SEVERITY_ORDER)
    df = df.sort_values("ordre").drop(columns="ordre").reset_index(drop=True)
    return df
