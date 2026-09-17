import plotly.graph_objects as go
import streamlit as st

from alerts import watchlist_alerts, portfolio_alerts
from auth import require_auth
from db import (
    add_valorisation,
    fetch_portefeuille,
    fetch_theses,
    fetch_valorisations,
    fetch_watchlist,
    get_thresholds,
    get_weights,
    init_db,
    update_watchlist_row,
)
from score import CHECKLIST_ITEMS, METRIC_LABELS, checklist_status, compute_score

st.set_page_config(page_title="Fiche Titre — ValueBoard", page_icon="🗂️", layout="wide")
require_auth()
init_db()

st.title("🗂️ Fiche Titre")
st.caption("La vue de travail pour décider sur UN titre : score détaillé, checklist, calculateur, alertes.")

watchlist = fetch_watchlist()

if watchlist.empty:
    st.info("Ajoute d'abord des titres dans la **Watchlist**.")
    st.stop()

options = {f"{row.ticker} — {row.nom or 'sans nom'}": row.id for row in watchlist.itertuples()}
choix = st.selectbox("Titre", list(options.keys()))
row_id = options[choix]
row = watchlist[watchlist["id"] == row_id].iloc[0]
row_dict = row.to_dict()

weights = get_weights()
thresholds = get_thresholds()
result = compute_score(row_dict, weights, thresholds)

# ---------------------------------------------------------------- en-tête
VERDICT_COLORS = {
    "Achat fort": "#0ca30c", "À surveiller": "#eda100",
    "Écarter": "#d03b3b", "Données insuffisantes": "#898781",
}
c1, c2, c3 = st.columns([2, 1, 1])
c1.markdown(f"## {row['ticker']} — {row['nom'] or ''}")
c1.caption(f"{row['secteur'] or 'Secteur non renseigné'} · Statut : {row['statut']}")
score_txt = f"{result['score']:.0f}/100" if result["score"] is not None else "N/A"
c2.metric("Score composite", score_txt)
color = VERDICT_COLORS.get(result["verdict"], "#898781")
c3.markdown(
    f"<div style='padding:10px;border-radius:8px;background:{color}22;"
    f"border:1px solid {color};text-align:center;font-weight:600;color:{color};'>"
    f"{result['verdict']}</div>",
    unsafe_allow_html=True,
)
if result["coverage"] < result["coverage_total"]:
    st.caption(
        f"⚠️ Score basé sur {result['coverage']}/{result['coverage_total']} critères "
        "(données manquantes exclues du calcul, pas pénalisées)."
    )

st.divider()

# ------------------------------------------------------------------ alertes
wl_single = watchlist[watchlist["id"] == row_id]
alerts_this = watchlist_alerts(wl_single, thresholds)
portefeuille = fetch_portefeuille()
pf_this = portefeuille[portefeuille["ticker"] == row["ticker"]]
if not pf_this.empty:
    theses_all = fetch_theses()
    val_all = fetch_valorisations()
    alerts_this += portfolio_alerts(pf_this, watchlist, theses_all, val_all, thresholds)

if alerts_this:
    st.subheader("⚠️ Alertes actives")
    for a in alerts_this:
        icon = {"critical": "🔴", "warning": "🟠", "info": "🟢"}.get(a["severity"], "⚪")
        st.markdown(f"{icon} **{a['type']}** — {a['message']}")
    st.divider()

# --------------------------------------------------------- radar + sous-scores
col_radar, col_detail = st.columns([1, 1])

with col_radar:
    st.subheader("Profil du titre")
    labels = list(METRIC_LABELS.values())
    values = [result["sub_scores"][k] if result["sub_scores"][k] is not None else 0 for k in METRIC_LABELS]
    fig = go.Figure()
    fig.add_trace(go.Scatterpolar(
        r=values + [values[0]],
        theta=labels + [labels[0]],
        fill="toself",
        fillcolor="rgba(42,120,214,0.25)",
        line=dict(color="#2a78d6", width=2),
        name=row["ticker"],
    ))
    fig.update_layout(
        polar=dict(
            radialaxis=dict(visible=True, range=[0, 100], gridcolor="#e1e0d9"),
            angularaxis=dict(gridcolor="#e1e0d9"),
            bgcolor="#fcfcfb",
        ),
        showlegend=False,
        paper_bgcolor="#fcfcfb",
        margin=dict(l=40, r=40, t=20, b=20),
        height=380,
    )
    st.plotly_chart(fig)

with col_detail:
    st.subheader("Détail des sous-scores")
    for key, label in METRIC_LABELS.items():
        sub = result["sub_scores"][key]
        raw = result["raw_values"][key]
        if sub is None:
            st.caption(f"**{label}** — donnée non renseignée")
        else:
            st.progress(int(sub), text=f"{label} : {sub:.0f}/100 (valeur brute : {raw:g})")

st.divider()

# ----------------------------------------------------------------- checklist
st.subheader("Checklist Graham")
statuses = checklist_status(row_dict)
manual_updates = {}
cols = st.columns(2)
for i, item in enumerate(statuses):
    col = cols[i % 2]
    if item["kind"] == "manuel":
        manual_updates[item["key"]] = col.checkbox(
            item["label"], value=bool(item["value"]), help=item["help"], key=f"chk_{item['key']}_{row_id}"
        )
    else:
        icon = "✅" if item["value"] else ("❌" if item["value"] is False else "➖")
        col.markdown(f"{icon} **{item['label']}** *(auto)* — {item['help']}")

if st.button("Enregistrer la checklist", type="primary"):
    update_watchlist_row(int(row_id), {k: int(v) for k, v in manual_updates.items()})
    st.success("Checklist mise à jour.")
    st.rerun()

st.divider()

# ------------------------------------------------------- calculateur intégré
st.subheader("Calculateur de valeur intrinsèque")
methode = st.radio("Méthode", ["Graham Number", "DCF simplifié"], horizontal=True, key=f"methode_{row_id}")

if methode == "Graham Number":
    c1, c2 = st.columns(2)
    bpa = c1.number_input("BPA", step=0.01, format="%.2f", key=f"bpa_{row_id}")
    vcpa = c2.number_input("Valeur comptable par action", step=0.01, format="%.2f", key=f"vcpa_{row_id}")
    if st.button("Calculer la valeur intrinsèque", key=f"calc_graham_{row_id}"):
        if bpa <= 0 or vcpa <= 0:
            st.error("BPA et valeur comptable doivent être positifs.")
        else:
            vi = (22.5 * bpa * vcpa) ** 0.5
            prix = row["prix_actuel"] or 0
            marge = (vi - prix) / vi * 100 if vi and prix else None
            st.metric("Valeur intrinsèque", f"{vi:,.2f}")
            if marge is not None:
                st.metric("Marge de sécurité", f"{marge:,.1f} %")
            add_valorisation(dict(
                ticker=row["ticker"], methode="Graham Number",
                parametres=f"BPA={bpa}; VCPA={vcpa}",
                valeur_intrinseque=vi, prix_actuel=prix or None, marge_securite=marge,
            ))
            st.success("Calcul enregistré — les alertes de portefeuille en tiendront compte.")
            st.rerun()
else:
    c1, c2, c3 = st.columns(3)
    fcf = c1.number_input("FCF actuel (M€)", step=1.0, format="%.1f", key=f"fcf_{row_id}")
    nb_actions = c2.number_input("Actions en circulation (M)", min_value=0.01, step=0.1, format="%.2f", key=f"nbact_{row_id}")
    croissance = c3.number_input("Croissance FCF (%)", value=8.0, step=0.5, key=f"croiss_{row_id}")
    c4, c5 = st.columns(2)
    taux = c4.number_input("Taux d'actualisation (%)", value=10.0, step=0.5, key=f"taux_{row_id}")
    g_term = c5.number_input("Croissance terminale (%)", value=2.0, step=0.1, key=f"gterm_{row_id}")
    nb_annees = st.slider("Années projetées", 3, 15, 10, key=f"annees_{row_id}")

    if st.button("Calculer la valeur intrinsèque", key=f"calc_dcf_{row_id}"):
        g, r, gt = croissance / 100, taux / 100, g_term / 100
        if r <= gt or nb_actions <= 0:
            st.error("Vérifie que le taux d'actualisation > croissance terminale et que le nombre d'actions est positif.")
        else:
            valeur_actualisee, f = 0.0, fcf
            for annee in range(1, nb_annees + 1):
                f *= (1 + g)
                valeur_actualisee += f / ((1 + r) ** annee)
            vt = f * (1 + gt) / (r - gt)
            vt_actualisee = vt / ((1 + r) ** nb_annees)
            valeur_entreprise = valeur_actualisee + vt_actualisee
            vi = valeur_entreprise / nb_actions
            prix = row["prix_actuel"] or 0
            marge = (vi - prix) / vi * 100 if vi and prix else None
            st.metric("Valeur intrinsèque par action", f"{vi:,.2f}")
            if marge is not None:
                st.metric("Marge de sécurité", f"{marge:,.1f} %")
            add_valorisation(dict(
                ticker=row["ticker"], methode="DCF simplifié",
                parametres=f"FCF={fcf}M; croissance={croissance}%; taux={taux}%; g_term={g_term}%; annees={nb_annees}",
                valeur_intrinseque=vi, prix_actuel=prix or None, marge_securite=marge,
            ))
            st.success("Calcul enregistré — les alertes de portefeuille en tiendront compte.")
            st.rerun()

hist = fetch_valorisations(row["ticker"])
if not hist.empty:
    st.caption("Historique des calculs pour ce titre")
    st.dataframe(hist.drop(columns=["id"]), width="stretch", hide_index=True)

st.divider()
st.caption("📓 Pour documenter la thèse d'investissement de ce titre, rends-toi sur la page **Journal**.")
