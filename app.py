"""
ValueBoard — tableau de bord d'aide à la décision, complémentaire à
Value Investing Screener (VIS).

Ce n'est pas un screener : VIS fait déjà ce travail. ValueBoard sert à
tout ce qui vient après repérer un titre — le noter selon tes propres
critères, comparer les candidats, détecter les signaux qui méritent une
décision, et suivre le portefeuille réel.
"""

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from alerts import all_alerts
from auth import require_auth
from db import (
    fetch_portefeuille,
    fetch_theses,
    fetch_valorisations,
    fetch_watchlist,
    get_thresholds,
    get_weights,
    init_db,
)
from score import VERDICT_COLORS, compute_score

st.set_page_config(page_title="ValueBoard", page_icon="🧭", layout="wide")
require_auth()
init_db()

st.title("🧭 ValueBoard")
st.caption(
    "Un compagnon de décision pour tes recherches Value Investing Screener (VIS) : "
    "score, checklist, alertes et comparaison — pour savoir quoi acheter, quand "
    "réévaluer, et comment répartir ton capital."
)

watchlist = fetch_watchlist()
portefeuille = fetch_portefeuille()
theses = fetch_theses()
valorisations = fetch_valorisations()
weights = get_weights()
thresholds = get_thresholds()

if watchlist.empty:
    st.info("Ta watchlist est vide — commence par la page **Watchlist** dans le menu.")
    st.stop()

scored = []
for row in watchlist.to_dict("records"):
    result = compute_score(row, weights, thresholds)
    scored.append({**row, "score": result["score"], "verdict": result["verdict"]})
df_scored = pd.DataFrame(scored)

df_alerts = all_alerts(watchlist, portefeuille, theses, valorisations, thresholds)

c1, c2, c3, c4 = st.columns(4)
c1.metric("Titres suivis", len(watchlist))
c2.metric("Achats forts", int((df_scored["verdict"] == "Achat fort").sum()))
c3.metric("Positions en portefeuille", len(portefeuille))
n_critical = int((df_alerts["severity"] == "critical").sum()) if not df_alerts.empty else 0
c4.metric("Alertes critiques", n_critical)

st.divider()

col_left, col_right = st.columns([1, 1])

with col_left:
    st.subheader("Répartition des verdicts")
    counts = df_scored["verdict"].value_counts()
    order = ["Achat fort", "À surveiller", "Écarter", "Données insuffisantes"]
    counts = counts.reindex(order).dropna()
    fig = go.Figure(go.Bar(
        x=counts.values,
        y=counts.index,
        orientation="h",
        marker_color=[VERDICT_COLORS.get(v, "#898781") for v in counts.index],
    ))
    fig.update_layout(
        plot_bgcolor="#fcfcfb", paper_bgcolor="#fcfcfb",
        xaxis=dict(title="Nombre de titres", gridcolor="#e1e0d9"),
        yaxis=dict(title=None),
        margin=dict(l=10, r=10, t=10, b=10),
        height=260,
        showlegend=False,
    )
    st.plotly_chart(fig)

with col_right:
    st.subheader("🏆 Meilleurs candidats")
    top = df_scored.sort_values("score", ascending=False, na_position="last").head(5)
    st.dataframe(
        top[["ticker", "nom", "score", "verdict"]].rename(columns={"score": "Score", "verdict": "Verdict"}),
        width="stretch",
        hide_index=True,
    )
    st.caption("Détail sur la page **Fiche Titre**, comparaison sur la page **Comparateur**.")

st.divider()

st.subheader("🚨 Alertes prioritaires")
if df_alerts.empty:
    st.success("Aucune alerte active pour le moment.")
else:
    for _, a in df_alerts.head(5).iterrows():
        icon = {"critical": "🔴", "warning": "🟠", "info": "🟢"}.get(a["severity"], "⚪")
        st.markdown(f"{icon} **{a['ticker']}** — *{a['type']}* : {a['message']}")
    if len(df_alerts) > 5:
        st.caption(f"+ {len(df_alerts) - 5} autre(s) alerte(s) — voir la page **Alertes**.")
