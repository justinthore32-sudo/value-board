"""
Définit (ou change) le nom d'utilisateur et le mot de passe de ValueBoard.

À lancer en local, depuis la racine du projet :

    python scripts/set_credentials.py

La saisie du mot de passe est masquée (getpass) et n'est jamais affichée ni
écrite en clair : seul un hash PBKDF2 salé est enregistré, dans
.streamlit/secrets.toml (fichier local, jamais commité — voir .gitignore).

Pour un déploiement sur Streamlit Community Cloud, recopie le contenu de ce
fichier dans les "Secrets" de l'application (menu de l'app → Settings →
Secrets) : le fichier local n'est jamais poussé sur le dépôt public.
"""

from __future__ import annotations

import getpass
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

    password = getpass.getpass("Mot de passe : ")
    confirm = getpass.getpass("Confirme le mot de passe : ")
    if not password:
        print("Le mot de passe ne peut pas être vide.")
        return
    if password != confirm:
        print("Les deux saisies ne correspondent pas. Rien n'a été enregistré.")
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
