# ValueBoard — Worker Cloudflare

Backend mono-utilisateur pour la version statique de ValueBoard (`../docs`) :
authentification (PBKDF2 + sessions en KV) et stockage des données
(watchlist, portefeuille, thèses, réglages — un seul blob JSON).

## Développement local

```bash
npm install
npm run dev        # wrangler dev, KV simulé localement (jamais la vraie base)
bash test.sh        # suite de tests d'intégration automatisée
```

## Déploiement

```bash
npm run deploy
```

Nécessite d'être connecté à Cloudflare (`npx wrangler login`, une fois).

## Mot de passe oublié / réinitialiser le compte

Il n'y a volontairement pas de flow de récupération de mot de passe dans
l'app (coût de développement disproportionné pour un outil mono-utilisateur).
Si l'accès est perdu, on supprime le compte pour permettre une nouvelle
création (les données elles-mêmes ne sont pas touchées) :

```bash
npx wrangler kv key delete --namespace-id <ID_DU_NAMESPACE_STORE> "account" --remote
```

Le prochain chargement de `login.html` affichera alors à nouveau l'écran de
création de compte.

## Limites connues

- Un seul compte par Worker (pas de multi-utilisateur, pas d'admin).
- `PUT /api/data` refuse les charges de plus de 2 Mo (voir `MAX_DATA_BYTES`
  dans `src/index.js`) — largement suffisant pour un usage perso, protège
  contre un bug client qui ferait gonfler le stockage indéfiniment.
