import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from db import fetch_watchlist, get_thresholds, get_weights, init_db
from score import METRIC_LABELS, compute_score

st.set_page_config(page_title="Comparateur — ValueBoard", page_icon="⚖️", layout="wide")
init_db()

st.title("⚖️ Comparateur")
st.caption(
    "Compare plusieurs candidats côte à côte pour décider lequel privilégier, "
    "et obtiens une piste de répartition de capital entre les meilleurs."
)

CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]

watchlist = fetch_watchlist()
if watchlist.empty:
    st.info("Ajoute des titres dans la **Watchlist** pour pouvoir les comparer.")
    st.stop()

weights = get_weights()
thresholds = get_thresholds()

scored = []
for row in watchlist.to_dict("records"):
    result = compute_score(row, weights, thresholds)
    scored.append({**row, "score": result["score"], "verdict": result["verdict"], "sub_scores": result["sub_scores"]})
df = pd.DataFrame(scored).sort_values("score", ascending=False, na_position="last")

st.subheader("Classement")
st.dataframe(
    df[["ticker", "nom", "statut", "score", "verdict"]].rename(
        columns={"score": "Score", "verdict": "Verdict"}
    ),
    width="stretch",
    hide_index=True,
)

st.divider()

st.subheader("Comparaison visuelle (radar)")
tickers_dispo = df["ticker"].tolist()
default_sel = df.head(min(5, len(df)))["ticker"].tolist()
selection = st.multiselect(
    "Titres à comparer (max 8 pour rester lisible)", tickers_dispo, default=default_sel, max_selections=8
)

if selection:
    labels = list(METRIC_LABELS.values())
    fig = go.Figure()
    for i, ticker in enumerate(selection):
        sub_row = df[df["ticker"] == ticker].iloc[0]
        values = [sub_row["sub_scores"][k] if sub_row["sub_scores"][k] is not None else 0 for k in METRIC_LABELS]
        color = CATEGORICAL[i % len(CATEGORICAL)]
        fig.add_trace(go.Scatterpolar(
            r=values + [values[0]],
            theta=labels + [labels[0]],
            name=ticker,
            line=dict(color=color, width=2),
            opacity=0.85,
        ))
    fig.update_layout(
        polar=dict(
            radialaxis=dict(visible=True, range=[0, 100], gridcolor="#e1e0d9"),
            angularaxis=dict(gridcolor="#e1e0d9"),
            bgcolor="#fcfcfb",
        ),
        paper_bgcolor="#fcfcfb",
        legend=dict(orientation="h", yanchor="bottom", y=-0.15),
        margin=dict(l=40, r=40, t=20, b=20),
        height=460,
    )
    st.plotly_chart(fig)
else:
    st.info("Sélectionne au moins un titre pour afficher le radar.")

st.divider()

st.subheader("Piste d'allocation de capital (indicative)")
st.caption(
    "⚠️ Ceci n'est **pas un conseil en investissement** — c'est une heuristique simple "
    "qui répartit un budget fictif proportionnellement au score de conviction, avec un "
    "plafond par ligne pour éviter la concentration excessive. À ajuster selon ta propre "
    "gestion du risque."
)

c1, c2 = st.columns(2)
budget = c1.number_input("Budget fictif à répartir", min_value=0.0, value=10000.0, step=500.0)
plafond = c2.slider("Plafond par ligne (%)", min_value=5, max_value=100, value=25, step=5)

eligibles = df[(df["verdict"].isin(["Achat fort", "À surveiller"])) & (df["score"].notna())].copy()
if eligibles.empty:
    st.info("Aucun titre au-dessus du seuil \"À surveiller\" pour proposer une allocation.")
else:
    eligibles["poids_brut"] = eligibles["score"]
    eligibles["poids_pct"] = eligibles["poids_brut"] / eligibles["poids_brut"].sum() * 100
    eligibles["poids_pct"] = eligibles["poids_pct"].clip(upper=plafond)
    # renormalise après plafonnement pour que le total fasse toujours 100%
    eligibles["poids_pct"] = eligibles["poids_pct"] / eligibles["poids_pct"].sum() * 100
    eligibles["montant"] = eligibles["poids_pct"] / 100 * budget
    eligibles = eligibles.sort_values("poids_pct", ascending=False)

    fig2 = go.Figure(go.Bar(
        x=eligibles["poids_pct"],
        y=eligibles["ticker"],
        orientation="h",
        marker_color=CATEGORICAL[: len(eligibles)] if len(eligibles) <= 8 else "#2a78d6",
        text=[f"{v:.1f}%" for v in eligibles["poids_pct"]],
        textposition="outside",
    ))
    fig2.update_layout(
        plot_bgcolor="#fcfcfb", paper_bgcolor="#fcfcfb",
        xaxis=dict(title="Poids suggéré (%)", gridcolor="#e1e0d9"),
        yaxis=dict(title=None, autorange="reversed"),
        margin=dict(l=10, r=10, t=20, b=10),
        height=max(240, 40 * len(eligibles)),
        showlegend=False,
    )
    st.plotly_chart(fig2)

    st.dataframe(
        eligibles[["ticker", "nom", "score", "verdict", "poids_pct", "montant"]].rename(columns={
            "score": "Score", "verdict": "Verdict", "poids_pct": "Poids (%)", "montant": "Montant",
        }),
        width="stretch",
        hide_index=True,
    )
