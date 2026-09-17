"""
Définit (ou change) le nom d'utilisateur et le mot de passe de ValueBoard.

À lancer en local, depuis la racine du projet :

    python scripts/set_credentials.py

Le mot de passe est saisi en clair dans le terminal (visible pendant la
frappe) — c'est un script 100% local qui ne fait aucun appel réseau ; seul
un hash PBKDF2 salé est ensuite enregistré, dans .streamlit/secrets.toml
(fichier local, jamais commité — voir .gitignore).

Pour un déploiement sur Streamlit Community Cloud, recopie le contenu de ce
fichier dans les "Secrets" de l'application (menu de l'app → Settings →
Secrets) : le fichier local n'est jamais poussé sur le dépôt public.
"""

from __future__ import annotations

import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from auth import hash_password  # noqa: E402

SECRETS_PATH = Path(__file__).parent.parent / ".streamlit" / "secrets.toml"


def main() -> None:
    username = input("Nom d'utilisateur : ").strip()
    if not username:
        print("Le nom d'utilisateur ne peut pas être vide.")
        return

    password = input("Mot de passe (visible pendant la frappe, terminal local uniquement) : ")
    if not password:
        print("Le mot de passe ne peut pas être vide.")
        return

    print(f"\nTu as saisi : {'*' * len(password)} ({len(password)} caractères)")
    confirm = input("Confirmer et enregistrer ? (o/n) : ").strip().lower()
    if confirm not in ("o", "oui", "y", "yes"):
        print("Annulé. Rien n'a été enregistré.")
        return

    salt = secrets.token_hex(16)
    password_hash = hash_password(password, salt)

    SECRETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SECRETS_PATH.write_text(
        f'AUTH_USERNAME = "{username}"\n'
        f'AUTH_PASSWORD_HASH = "{password_hash}"\n'
        f'AUTH_SALT = "{salt}"\n'
    )
    print(f"\nIdentifiants enregistrés dans {SECRETS_PATH} (fichier local, jamais commité).")
    print("Relance `streamlit run app.py` pour te connecter.")


if __name__ == "__main__":
    main()
