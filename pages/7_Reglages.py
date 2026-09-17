import streamlit as st

from db import (
    DEFAULT_THRESHOLDS,
    DEFAULT_WEIGHTS,
    get_thresholds,
    get_weights,
    init_db,
    reset_settings,
    set_setting,
)
from score import METRIC_LABELS

st.set_page_config(page_title="Réglages — ValueBoard", page_icon="⚙️", layout="wide")
init_db()

st.title("⚙️ Réglages")
st.caption(
    "Le score composite et les alertes sont entièrement pilotés par ces réglages. "
    "Les valeurs par défaut s'inspirent de repères classiques du value investing "
    "(Graham, Piotroski, Altman) mais rien n'est figé : ajuste-les selon ta propre méthode."
)

weights = get_weights()
thresholds = get_thresholds()

st.subheader("Pondération du score composite")
st.caption(
    "Chaque critère pèse dans le score final proportionnellement à son curseur. "
    "Mets un critère à 0 pour l'exclure complètement. Si une donnée est absente pour "
    "un titre, son poids est automatiquement retiré du calcul (pas de pénalité pour donnée manquante)."
)

with st.form("weights_form"):
    new_weights = {}
    cols = st.columns(3)
    for i, (key, label) in enumerate(METRIC_LABELS.items()):
        col = cols[i % 3]
        new_weights[key] = col.slider(
            label, min_value=0, max_value=50, value=int(weights.get(key, DEFAULT_WEIGHTS[key])), step=1
        )

    total = sum(new_weights.values())
    st.caption(f"Somme actuelle des poids : **{total}** (n'a pas besoin de faire 100 — c'est relatif).")

    if st.form_submit_button("Enregistrer la pondération", type="primary"):
        set_setting("weights", new_weights)
        st.success("Pondération mise à jour.")
        st.rerun()

st.divider()

st.subheader("Seuils du verdict")
c1, c2 = st.columns(2)
with st.form("verdict_form"):
    achat_fort = c1.number_input(
        "Score minimum pour \"Achat fort\"", min_value=0.0, max_value=100.0,
        value=float(thresholds.get("verdict_achat_fort", DEFAULT_THRESHOLDS["verdict_achat_fort"])), step=1.0,
    )
    surveiller = c2.number_input(
        "Score minimum pour \"À surveiller\"", min_value=0.0, max_value=100.0,
        value=float(thresholds.get("verdict_surveiller", DEFAULT_THRESHOLDS["verdict_surveiller"])), step=1.0,
    )
    if st.form_submit_button("Enregistrer les seuils de verdict", type="primary"):
        if surveiller >= achat_fort:
            st.error("Le seuil \"À surveiller\" doit être inférieur au seuil \"Achat fort\".")
        else:
            thresholds["verdict_achat_fort"] = achat_fort
            thresholds["verdict_surveiller"] = surveiller
            set_setting("thresholds", thresholds)
            st.success("Seuils de verdict mis à jour.")
            st.rerun()

st.divider()

st.subheader("Seuils d'alerte")
st.caption("Ces seuils déclenchent les badges sur la Watchlist, le Portefeuille et la page Alertes.")

with st.form("thresholds_form"):
    c1, c2 = st.columns(2)
    marge_op = c1.number_input(
        "Marge de sécurité déclenchant une alerte \"Opportunité\" (%)",
        min_value=0.0, value=float(thresholds.get("marge_securite_opportunite", 30.0)), step=1.0,
    )
    f_score_alerte = c2.number_input(
        "F-Score en dessous duquel \"Qualité faible\" (0-9)",
        min_value=0, max_value=9, value=int(thresholds.get("f_score_alerte", 4)), step=1,
    )
    c3, c4 = st.columns(2)
    dette_alerte = c3.number_input(
        "Dette/EBITDA au-dessus de laquelle \"Dette élevée\"",
        min_value=0.0, value=float(thresholds.get("dette_ebitda_alerte", 3.0)), step=0.5,
    )
    z_detresse = c4.number_input(
        "Altman Z-Score en dessous duquel \"Détresse financière\"",
        min_value=0.0, value=float(thresholds.get("z_score_detresse", 1.81)), step=0.05, format="%.2f",
    )
    z_sain = st.number_input(
        "Altman Z-Score au-dessus duquel la zone est considérée \"saine\"",
        min_value=0.0, value=float(thresholds.get("z_score_sain", 2.99)), step=0.05, format="%.2f",
    )

    if st.form_submit_button("Enregistrer les seuils d'alerte", type="primary"):
        thresholds.update(dict(
            marge_securite_opportunite=marge_op,
            f_score_alerte=f_score_alerte,
            dette_ebitda_alerte=dette_alerte,
            z_score_detresse=z_detresse,
            z_score_sain=z_sain,
        ))
        set_setting("thresholds", thresholds)
        st.success("Seuils d'alerte mis à jour.")
        st.rerun()

st.divider()
if st.button("↩️ Réinitialiser tous les réglages par défaut"):
    reset_settings()
    st.warning("Réglages réinitialisés aux valeurs par défaut.")
    st.rerun()
