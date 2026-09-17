import streamlit as st

from alerts import SEVERITY_ICON, all_alerts
from db import (
    fetch_portefeuille,
    fetch_theses,
    fetch_valorisations,
    fetch_watchlist,
    get_thresholds,
    init_db,
)

st.set_page_config(page_title="Alertes — ValueBoard", page_icon="🚨", layout="wide")
init_db()

st.title("🚨 Alertes")
st.caption(
    "Vue consolidée de tout ce qui mérite ton attention : opportunités sur la watchlist "
    "et signaux de risque sur le portefeuille. Réglable dans la page Réglages."
)

watchlist = fetch_watchlist()
portefeuille = fetch_portefeuille()
theses = fetch_theses()
valorisations = fetch_valorisations()
thresholds = get_thresholds()

df = all_alerts(watchlist, portefeuille, theses, valorisations, thresholds)

if df.empty:
    st.success("Aucune alerte active pour le moment.")
else:
    c1, c2, c3 = st.columns(3)
    c1.metric("🔴 Critiques", int((df["severity"] == "critical").sum()))
    c2.metric("🟠 À surveiller", int((df["severity"] == "warning").sum()))
    c3.metric("🟢 Opportunités", int((df["severity"] == "info").sum()))

    st.divider()

    categories = st.multiselect(
        "Filtrer par catégorie", sorted(df["categorie"].unique()), default=sorted(df["categorie"].unique())
    )
    df_f = df[df["categorie"].isin(categories)]

    for _, a in df_f.iterrows():
        icon = SEVERITY_ICON.get(a["severity"], "⚪")
        with st.container(border=True):
            c1, c2 = st.columns([3, 1])
            c1.markdown(f"{icon} **{a['ticker']}** — {a['nom']} · *{a['type']}* ({a['categorie']})")
            c1.caption(a["message"])
