import pandas as pd
import streamlit as st

from alerts import watchlist_alerts
from auth import require_auth
from db import (
    STATUTS,
    add_watchlist_row,
    delete_watchlist_row,
    fetch_watchlist,
    get_thresholds,
    get_weights,
    init_db,
    update_watchlist_row,
)
from score import checklist_pass_rate, compute_score

st.set_page_config(page_title="Watchlist — ValueBoard", page_icon="🔎", layout="wide")
require_auth()
init_db()

st.title("🔎 Watchlist")
st.caption(
    "Centralise ici les titres repérés dans VIS avec leurs métriques clés. "
    "Le score et le verdict sont recalculés automatiquement selon tes réglages."
)

with st.expander("➕ Ajouter un titre", expanded=st.session_state.get("wl_empty", True)):
    with st.form("add_watchlist", clear_on_submit=True):
        c1, c2, c3 = st.columns(3)
        ticker = c1.text_input("Ticker *", placeholder="ex. MC.PA")
        nom = c2.text_input("Nom de l'entreprise")
        secteur = c3.text_input("Secteur")

        c4, c5, c6 = st.columns(3)
        statut = c4.selectbox("Statut", STATUTS)
        prix_actuel = c5.number_input("Prix actuel", min_value=0.0, step=0.1, format="%.2f")
        devise = c6.text_input("Devise", value="EUR")

        st.markdown("**Métriques issues de VIS**")
        c7, c8, c9, c10 = st.columns(4)
        per = c7.number_input("PER", min_value=0.0, step=0.1, format="%.2f")
        pb = c8.number_input("P/B", min_value=0.0, step=0.1, format="%.2f")
        pcf = c9.number_input("P/CF", min_value=0.0, step=0.1, format="%.2f")
        rendement_dividende = c10.number_input("Rdt dividende (%)", min_value=0.0, step=0.1, format="%.2f")

        c11, c12, c13, c14 = st.columns(4)
        dette_ebitda = c11.number_input("Dette/EBITDA", step=0.1, format="%.2f")
        roe = c12.number_input("ROE (%)", step=0.1, format="%.2f")
        f_score = c13.number_input("Piotroski F-Score", min_value=0, max_value=9, step=1)
        z_score = c14.number_input("Altman Z-Score", step=0.1, format="%.2f")

        c15, c16 = st.columns(2)
        marge_securite_vis = c15.number_input(
            "Marge de sécurité VIS (%)", step=0.1, format="%.2f",
            help="La marge de sécurité calculée par VIS.",
        )
        croissance_estimee = c16.number_input("Croissance estimée (%/an)", step=0.1, format="%.2f")

        st.markdown("**Checklist Graham (critères qualitatifs)**")
        cc1, cc2, cc3, cc4, cc5 = st.columns(5)
        taille_ok = cc1.checkbox("Taille adéquate")
        bilan_solide = cc2.checkbox("Bilan solide")
        benefices_stables = cc3.checkbox("Bénéfices stables")
        dividende_continu = cc4.checkbox("Dividende continu")
        croissance_benefices = cc5.checkbox("Croissance bénéfices")

        notes = st.text_area("Notes")

        submitted = st.form_submit_button("Ajouter à la watchlist", type="primary")
        if submitted:
            if not ticker:
                st.error("Le ticker est obligatoire.")
            else:
                add_watchlist_row(
                    dict(
                        ticker=ticker.upper().strip(),
                        nom=nom,
                        secteur=secteur,
                        statut=statut,
                        prix_actuel=prix_actuel or None,
                        devise=devise,
                        per=per or None,
                        pb=pb or None,
                        pcf=pcf or None,
                        rendement_dividende=rendement_dividende or None,
                        dette_ebitda=dette_ebitda or None,
                        roe=roe or None,
                        f_score=int(f_score) or None,
                        z_score=z_score or None,
                        marge_securite_vis=marge_securite_vis or None,
                        croissance_estimee=croissance_estimee or None,
                        taille_ok=int(taille_ok),
                        bilan_solide=int(bilan_solide),
                        benefices_stables=int(benefices_stables),
                        dividende_continu=int(dividende_continu),
                        croissance_benefices=int(croissance_benefices),
                        notes=notes,
                    )
                )
                st.success(f"{ticker.upper()} ajouté à la watchlist.")
                st.rerun()

st.divider()

df = fetch_watchlist()
st.session_state["wl_empty"] = df.empty

if df.empty:
    st.info("Aucun titre pour l'instant. Ajoute ton premier candidat ci-dessus.")
else:
    weights = get_weights()
    thresholds = get_thresholds()

    scored_rows = []
    for row in df.to_dict("records"):
        result = compute_score(row, weights, thresholds)
        passed, known = checklist_pass_rate(row)
        scored_rows.append({
            **row,
            "score": result["score"],
            "verdict": result["verdict"],
            "checklist": f"{passed}/{known}" if known else "—",
        })
    df_scored = pd.DataFrame(scored_rows)

    al = watchlist_alerts(df, thresholds)
    alert_counts = pd.DataFrame(al)["ticker"].value_counts().to_dict() if al else {}
    df_scored["alertes"] = df_scored["ticker"].map(lambda t: alert_counts.get(t, 0))

    st.subheader(f"{len(df_scored)} titre(s) suivi(s)")

    statuts_filtre = st.multiselect("Filtrer par statut", STATUTS, default=STATUTS)
    df_filtre = df_scored[df_scored["statut"].isin(statuts_filtre)].sort_values(
        "score", ascending=False, na_position="last"
    )

    st.dataframe(
        df_filtre[
            [
                "ticker", "nom", "secteur", "statut", "score", "verdict", "checklist", "alertes",
                "per", "pb", "marge_securite_vis", "f_score", "z_score", "date_maj",
            ]
        ].rename(columns={
            "score": "Score", "verdict": "Verdict", "checklist": "Checklist ✓",
            "alertes": "⚠️ Alertes",
        }),
        width="stretch",
        hide_index=True,
    )
    st.caption(
        "💡 Pour l'analyse détaillée d'un titre (radar, checklist complète, calculateur), "
        "va sur la page **Fiche Titre**."
    )

    st.divider()
    st.subheader("✏️ Modifier / supprimer un titre")
    options = {f"{row.ticker} — {row.nom or 'sans nom'}": row.id for row in df.itertuples()}
    choix = st.selectbox("Sélectionner un titre", list(options.keys()))
    row_id = options[choix]
    row = df[df["id"] == row_id].iloc[0]

    with st.form("edit_watchlist"):
        c1, c2 = st.columns(2)
        nouveau_statut = c1.selectbox(
            "Statut", STATUTS, index=STATUTS.index(row["statut"]) if row["statut"] in STATUTS else 0
        )
        nouveau_prix = c2.number_input(
            "Prix actuel", value=float(row["prix_actuel"] or 0.0), step=0.1, format="%.2f"
        )
        nouvelles_notes = st.text_area("Notes", value=row["notes"] or "")

        cc1, cc2 = st.columns(2)
        if cc1.form_submit_button("Enregistrer les modifications", type="primary"):
            update_watchlist_row(
                int(row_id),
                dict(statut=nouveau_statut, prix_actuel=nouveau_prix, notes=nouvelles_notes),
            )
            st.success("Titre mis à jour.")
            st.rerun()
        if cc2.form_submit_button("🗑️ Supprimer ce titre"):
            delete_watchlist_row(int(row_id))
            st.warning(f"{choix} supprimé.")
            st.rerun()

    st.divider()
    csv = df_scored.drop(columns=["id"]).to_csv(index=False).encode("utf-8")
    st.download_button("⬇️ Exporter la watchlist (avec score) en CSV", csv, "watchlist.csv", "text/csv")
