import pandas as pd
import streamlit as st

from alerts import SEVERITY_ICON, portfolio_alerts
from auth import require_auth
from db import (
    add_position,
    delete_position,
    fetch_portefeuille,
    fetch_theses,
    fetch_valorisations,
    fetch_watchlist,
    get_thresholds,
    init_db,
    update_position,
)

st.set_page_config(page_title="Portefeuille — ValueBoard", page_icon="💼", layout="wide")
require_auth()
init_db()

st.title("💼 Portefeuille")
st.caption(
    "Suis tes positions réelles : prix de revient, poids, performance — et les alertes "
    "de risque (objectif de prix atteint, revue de thèse en retard)."
)

with st.expander("➕ Ajouter une position", expanded=st.session_state.get("pf_empty", True)):
    with st.form("add_position", clear_on_submit=True):
        c1, c2 = st.columns(2)
        ticker = c1.text_input("Ticker *")
        nom = c2.text_input("Nom de l'entreprise")

        c3, c4, c5 = st.columns(3)
        quantite = c3.number_input("Quantité", min_value=0.0, step=1.0, format="%.4f")
        pru = c4.number_input("Prix de revient unitaire (PRU)", min_value=0.0, step=0.01, format="%.2f")
        prix_actuel = c5.number_input("Prix actuel", min_value=0.0, step=0.01, format="%.2f")

        date_achat = st.date_input("Date d'achat")
        notes = st.text_area("Notes")

        if st.form_submit_button("Ajouter la position", type="primary"):
            if not ticker or quantite <= 0:
                st.error("Le ticker et une quantité positive sont obligatoires.")
            else:
                add_position(dict(
                    ticker=ticker.upper().strip(), nom=nom, quantite=quantite, pru=pru,
                    prix_actuel=prix_actuel or pru, date_achat=date_achat.isoformat(), notes=notes,
                ))
                st.success(f"Position {ticker.upper()} ajoutée.")
                st.rerun()

st.divider()

df = fetch_portefeuille()
st.session_state["pf_empty"] = df.empty

if df.empty:
    st.info("Aucune position enregistrée pour l'instant.")
else:
    watchlist = fetch_watchlist()
    theses = fetch_theses()
    valorisations = fetch_valorisations()
    thresholds = get_thresholds()
    pf_alerts = portfolio_alerts(df, watchlist, theses, valorisations, thresholds)
    alert_by_ticker = {}
    for a in pf_alerts:
        alert_by_ticker.setdefault(a["ticker"], []).append(a)

    df = df.copy()
    df["valeur_investie"] = df["quantite"] * df["pru"]
    df["valeur_actuelle"] = df["quantite"] * df["prix_actuel"]
    df["plus_value"] = df["valeur_actuelle"] - df["valeur_investie"]
    df["performance_pct"] = (df["prix_actuel"] / df["pru"] - 1) * 100
    total_investi = df["valeur_investie"].sum()
    total_actuel = df["valeur_actuelle"].sum()
    df["poids_pct"] = (df["valeur_actuelle"] / total_actuel * 100) if total_actuel else 0
    df["alertes"] = df["ticker"].map(lambda t: len(alert_by_ticker.get(t, [])))

    c1, c2, c3 = st.columns(3)
    c1.metric("Valeur investie", f"{total_investi:,.0f}")
    c2.metric("Valeur actuelle", f"{total_actuel:,.0f}")
    perf_globale = (total_actuel / total_investi - 1) * 100 if total_investi else 0
    c3.metric("Performance globale", f"{perf_globale:+.1f} %")

    st.dataframe(
        df[[
            "ticker", "nom", "quantite", "pru", "prix_actuel",
            "poids_pct", "performance_pct", "plus_value", "alertes", "date_achat",
        ]].rename(columns={
            "poids_pct": "Poids (%)", "performance_pct": "Perf. (%)",
            "plus_value": "Plus/moins-value", "alertes": "⚠️ Alertes",
        }),
        width="stretch",
        hide_index=True,
    )

    if pf_alerts:
        st.divider()
        st.subheader("⚠️ Alertes sur le portefeuille")
        for a in pf_alerts:
            icon = SEVERITY_ICON.get(a["severity"], "⚪")
            st.markdown(f"{icon} **{a['ticker']}** — *{a['type']}* : {a['message']}")

    st.divider()
    st.subheader("✏️ Mettre à jour le prix / modifier / supprimer une position")
    options = {f"{row.ticker} — {row.nom or 'sans nom'}": row.id for row in df.itertuples()}
    choix = st.selectbox("Sélectionner une position", list(options.keys()))
    row_id = options[choix]
    row = df[df["id"] == row_id].iloc[0]

    with st.form("edit_position"):
        c1, c2 = st.columns(2)
        nouveau_prix = c1.number_input("Prix actuel", value=float(row["prix_actuel"] or 0.0), step=0.01, format="%.2f")
        nouvelle_quantite = c2.number_input("Quantité", value=float(row["quantite"] or 0.0), step=1.0, format="%.4f")
        nouvelles_notes = st.text_area("Notes", value=row["notes"] or "")

        cc1, cc2 = st.columns(2)
        if cc1.form_submit_button("Enregistrer", type="primary"):
            update_position(
                int(row_id),
                dict(prix_actuel=nouveau_prix, quantite=nouvelle_quantite, notes=nouvelles_notes),
            )
            st.success("Position mise à jour.")
            st.rerun()
        if cc2.form_submit_button("🗑️ Supprimer cette position"):
            delete_position(int(row_id))
            st.warning(f"{choix} supprimé.")
            st.rerun()
