"""
Authentification locale pour ValueBoard — pas d'appel réseau, pas de service tiers.

Les identifiants (nom d'utilisateur, hash du mot de passe, sel) vivent dans
st.secrets, chargés depuis .streamlit/secrets.toml (jamais commité, voir
.gitignore) ou depuis les "Secrets" de l'application sur Streamlit Community
Cloud. Génère les tiens avec `python scripts/set_credentials.py`.
"""

from __future__ import annotations

import hashlib

import streamlit as st

PBKDF2_ITERATIONS = 200_000


def hash_password(password: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), PBKDF2_ITERATIONS
    ).hex()


def _secrets_configured() -> bool:
    # st.secrets lève une exception (pas juste une absence de clé) quand aucun
    # fichier secrets.toml n'existe du tout — on l'attrape largement ici.
    try:
        return all(k in st.secrets for k in ("AUTH_USERNAME", "AUTH_PASSWORD_HASH", "AUTH_SALT"))
    except Exception:
        return False


def require_auth() -> None:
    """À appeler juste après st.set_page_config() sur chaque page."""
    if st.session_state.get("authenticated"):
        with st.sidebar:
            try:
                username = st.secrets.get("AUTH_USERNAME", "")
            except Exception:
                username = ""
            st.caption(f"Connecté : {username}")
            if st.button("Déconnexion"):
                st.session_state["authenticated"] = False
                st.rerun()
        return

    st.title("🔒 ValueBoard")

    if not _secrets_configured():
        st.error(
            "Identifiants non configurés. Lance `python scripts/set_credentials.py` "
            "dans ton terminal pour définir un nom d'utilisateur et un mot de passe."
        )
        st.stop()

    with st.form("login"):
        username = st.text_input("Nom d'utilisateur")
        password = st.text_input("Mot de passe", type="password")
        submitted = st.form_submit_button("Se connecter", type="primary")

    if submitted:
        valid = (
            username == st.secrets["AUTH_USERNAME"]
            and hash_password(password, st.secrets["AUTH_SALT"]) == st.secrets["AUTH_PASSWORD_HASH"]
        )
        if valid:
            st.session_state["authenticated"] = True
            st.rerun()
        else:
            st.error("Nom d'utilisateur ou mot de passe incorrect.")

    st.stop()
