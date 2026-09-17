# ValueBoard

Un tableau de bord **d'aide à la décision**, complémentaire à
[Value Investing Screener](https://www.value-investing-screener.com/) (VIS).
VIS fait déjà très bien le travail de repérage (filtrage sur 30 000+
entreprises, PER, DCF, F-Score, Z-Score...). ValueBoard sert à tout ce qui
vient *après* : noter et hiérarchiser les candidats selon tes propres
critères, visualiser leurs forces/faiblesses, détecter les signaux qui
méritent une décision, et suivre ton portefeuille réel.

Toutes les données sont **saisies manuellement** : aucune clé API, aucun
appel réseau.

## Ce qui aide vraiment à décider

- **Score composite pondéré** — chaque titre reçoit une note /100 et un
  verdict (*Achat fort* / *À surveiller* / *Écarter*), calculés à partir de
  la marge de sécurité, du Piotroski F-Score, de l'Altman Z-Score, de la
  dette/EBITDA, du ROE et du rendement du dividende. **Les pondérations sont
  réglables** dans la page Réglages — aucune formule figée imposée.
- **Alertes sur seuils configurables** — opportunités repérées sur la
  watchlist (marge de sécurité élevée), signaux de risque sur le portefeuille
  (objectif de prix atteint, revue de thèse en retard, dette excessive,
  détresse financière).
- **Comparateur visuel** — radar superposé entre plusieurs candidats +
  classement, pour choisir entre plusieurs opportunités.
- **Checklist façon Graham** — les critères classiques de l'investisseur
  défensif (taille, bilan solide, stabilité des bénéfices, dividende continu,
  croissance, PER modéré, valorisation modérée), en ✅/❌ par titre.
- **Fiche Titre** — la vue de travail pour décider sur un titre précis :
  score détaillé, radar, checklist, calculateur de valeur intrinsèque
  (Graham Number / DCF simplifié) et alertes, tout au même endroit.
- **Piste d'allocation de capital** — répartition indicative d'un budget
  entre les meilleurs candidats, proportionnelle au score de conviction
  (avec plafond par ligne). **Ce n'est pas un conseil en investissement.**
- **Journal de thèse** et **Portefeuille** pour documenter tes décisions et
  suivre tes positions réelles dans le temps.

## Pages

| Page | Rôle |
|---|---|
| Accueil | Synthèse décisionnelle : répartition des verdicts, meilleurs candidats, alertes prioritaires |
| Watchlist | Saisie des titres + score/verdict/checklist en un coup d'œil |
| Fiche Titre | Analyse détaillée d'un titre : radar, checklist, calculateur, alertes |
| Comparateur | Classement, radar superposé multi-titres, allocation indicative |
| Alertes | Vue consolidée de toutes les alertes (watchlist + portefeuille) |
| Portefeuille | Positions réelles, performance, alertes de risque |
| Journal | Thèses d'investissement documentées |
| Réglages | Pondérations du score et seuils d'alerte, entièrement personnalisables |

## Lancer en local

Prérequis : Python 3.10+.

```bash
git clone <url-de-ton-repo>
cd value-board
python3 -m venv .venv
source .venv/bin/activate        # sous Windows : .venv\Scripts\activate
pip install -r requirements.txt
python scripts/set_credentials.py   # définit ton nom d'utilisateur / mot de passe
streamlit run app.py
```

## Authentification

L'app est protégée par un écran de connexion (nom d'utilisateur + mot de
passe) — aucun service tiers, aucun appel réseau : les identifiants sont un
hash PBKDF2 salé stocké dans `.streamlit/secrets.toml` (fichier local,
jamais commité, voir `.gitignore`).

**Premier lancement / changer les identifiants :**
```bash
python scripts/set_credentials.py
```
Le mot de passe est saisi en local (visible dans le terminal pendant la
frappe, pour éviter les erreurs de saisie) et n'est jamais transmis ailleurs. Tant que ce script n'a pas été lancé une première fois,
l'app affiche une erreur et bloque l'accès — c'est volontaire (sécurisé par
défaut plutôt qu'ouvert par défaut).

## Déployer gratuitement en ligne (Streamlit Community Cloud)

1. Crée un dépôt sur GitHub et pousse ce projet dedans :
   ```bash
   git init
   git add .
   git commit -m "Initial commit — ValueBoard"
   git branch -M main
   git remote add origin https://github.com/<ton-utilisateur>/value-board.git
   git push -u origin main
   ```
2. Va sur [share.streamlit.io](https://share.streamlit.io), connecte-toi avec
   ton compte GitHub.
3. **New app** → sélectionne le dépôt `value-board`, la branche `main`, le
   fichier `app.py`.
4. Avant de déployer (ou juste après) : dans le menu de l'app → **Settings**
   → **Secrets**, colle le contenu de ton `.streamlit/secrets.toml` local
   (`AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `AUTH_SALT`). Le fichier local
   n'est jamais poussé sur le dépôt public — c'est le seul moyen de
   transmettre les identifiants à la version en ligne.
5. Déploie — l'app est en ligne en quelques minutes, protégée par ton
   écran de connexion.

⚠️ Sur un déploiement gratuit, le système de fichiers n'est pas garanti
persistant entre redémarrages. Pour un usage régulier, privilégie un
lancement en local (ou ton propre serveur) pour que `data/value_board.db`
persiste vraiment. Exporte aussi régulièrement ta watchlist en CSV.

## Comment le score est calculé

Pour chaque titre, chaque métrique disponible est normalisée sur une échelle
0-100 (voir `score.py`), puis combinée selon les poids définis dans
Réglages. **Une donnée manquante est exclue du calcul plutôt que pénalisée**
— le score reflète alors la moyenne pondérée des seules métriques
disponibles, avec un indicateur de couverture affiché sur la Fiche Titre.

Le verdict final (*Achat fort* / *À surveiller* / *Écarter*) dépend de deux
seuils également réglables (75 et 50 par défaut).

## Structure du projet

```
value-board/
├── app.py                  # Accueil / synthèse décisionnelle
├── db.py                   # Accès SQLite (schéma, CRUD, réglages)
├── score.py                # Moteur de scoring + checklist Graham
├── alerts.py                # Moteur d'alertes (watchlist + portefeuille)
├── pages/
│   ├── 1_Watchlist.py
│   ├── 2_Fiche_Titre.py
│   ├── 3_Comparateur.py
│   ├── 4_Alertes.py
│   ├── 5_Portefeuille.py
│   ├── 6_Journal.py
│   └── 7_Reglages.py
├── data/                   # Base SQLite locale (non versionnée)
├── requirements.txt
└── .gitignore
```

## Tests

Le harnais officiel `streamlit.testing.v1.AppTest` couvre `app.py` et chaque
page, en base vide puis avec un jeu de données couvrant : un titre "Achat
fort" complet, un titre avec métriques manquantes, un titre en détresse
financière, une position avec objectif de prix atteint, une thèse en retard
de revue. Des tests unitaires couvrent aussi le moteur de scoring et les 6
types d'alertes indépendamment de Streamlit.

```bash
pip install -r requirements-dev.txt
pytest
```

## Limites et avertissements

- Cet outil ne fournit **aucun conseil en investissement**. Le score, la
  checklist et la suggestion d'allocation sont des heuristiques destinées à
  structurer ta réflexion, pas des recommandations.
- Les calculs de valeur intrinsèque (Graham Number, DCF) sont très sensibles
  aux hypothèses saisies — fais varier les paramètres avant de conclure.
- Aucune donnée n'est récupérée automatiquement : les chiffres ne sont à
  jour que si tu les mets à jour toi-même.
- Pense à faire des sauvegardes régulières (export CSV, copie de
  `data/value_board.db`).
