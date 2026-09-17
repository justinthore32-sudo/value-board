import streamlit as st

from auth import require_auth
from db import add_these, delete_these, fetch_theses, fetch_watchlist, init_db

st.set_page_config(page_title="Journal — ValueBoard", page_icon="📓", layout="wide")
require_auth()
init_db()

st.title("📓 Journal de thèse d'investissement")
st.caption(
    "Avant d'investir, écris ta thèse noir sur blanc. La date de revue alimente "
    "les alertes du portefeuille (page Alertes / Portefeuille)."
)

watchlist = fetch_watchlist()

if watchlist.empty:
    st.warning("Ajoute d'abord des titres dans la **Watchlist** avant de rédiger une thèse.")
else:
    with st.expander("➕ Nouvelle thèse", expanded=True):
        with st.form("add_these", clear_on_submit=True):
            options = {f"{row.ticker} — {row.nom or 'sans nom'}": row.id for row in watchlist.itertuples()}
            choix = st.selectbox("Titre concerné", list(options.keys()))

            these = st.text_area(
                "Thèse d'investissement",
                placeholder="Pourquoi ce titre est-il sous-évalué ? Quel est le catalyseur de "
                "réévaluation ? Qu'est-ce que le marché rate selon toi ?",
                height=120,
            )
            catalyseurs = st.text_area("Catalyseurs attendus", height=80)
            risques = st.text_area("Risques identifiés", height=80)
            date_revue = st.date_input("Date de revue prévue")

            if st.form_submit_button("Enregistrer la thèse", type="primary"):
                add_these(dict(
                    watchlist_id=options[choix], these=these, catalyseurs=catalyseurs,
                    risques=risques, date_revue=date_revue.isoformat(),
                ))
                st.success("Thèse enregistrée.")
                st.rerun()

st.divider()
st.subheader("Thèses enregistrées")

theses = fetch_theses()
if theses.empty:
    st.info("Aucune thèse enregistrée pour l'instant.")
else:
    for row in theses.itertuples():
        with st.container(border=True):
            c1, c2 = st.columns([4, 1])
            c1.markdown(f"### {row.ticker} — {row.nom or ''}")
            c2.caption(f"Rédigée le {row.date_creation}")

            st.markdown(f"**Thèse :** {row.these or '—'}")
            st.markdown(f"**Catalyseurs :** {row.catalyseurs or '—'}")
            st.markdown(f"**Risques :** {row.risques or '—'}")
            st.markdown(f"**Revue prévue le :** {row.date_revue or '—'}")

            if st.button("🗑️ Supprimer cette thèse", key=f"del_these_{row.id}"):
                delete_these(int(row.id))
                st.rerun()
