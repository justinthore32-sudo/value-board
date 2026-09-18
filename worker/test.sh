#!/bin/bash
# Test d'intégration du Worker : démarre wrangler dev sur un port dédié,
# rejoue le scénario admin/comptes/données complet, vérifie chaque réponse,
# puis arrête.
set -e

PORT=8799
BASE="http://localhost:$PORT"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0

cd "$DIR"
rm -rf .wrangler/state
npx wrangler dev --port "$PORT" --var ALLOWED_ORIGIN:http://localhost:$PORT > /tmp/valueboard_worker_test.log 2>&1 &
WORKER_PID=$!

cleanup() {
  kill $WORKER_PID 2>/dev/null || true
  wait $WORKER_PID 2>/dev/null || true
  rm -rf .wrangler/state
}
trap cleanup EXIT

echo "Démarrage de wrangler dev (pid $WORKER_PID)..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{}'; then break; fi
  sleep 1
done

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✔ $label"
  else
    echo "  ✘ $label — attendu [$expected], obtenu [$actual]"
    FAIL=1
  fi
}

jget() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

echo "1. Login admin (bootstrap automatique au premier login)"
resp=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"username":"admin","password":"admin1234"}')
ADMIN_TOKEN=$(echo "$resp" | jget "['token']")
check "token admin non vide" "1" "$([ -n "$ADMIN_TOKEN" ] && echo 1 || echo 0)"
check "isAdmin=true" "True" "$(echo "$resp" | jget "['isAdmin']")"

echo "2. Un seul compte listé (admin)"
resp=$(curl -s "$BASE/api/admin/users" -H "Authorization: Bearer $ADMIN_TOKEN")
check "1 compte" "1" "$(echo "$resp" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['users']))")"

echo "3. Création d'un compte utilisateur (test)"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/admin/users" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"username":"test","password":"secret123","displayName":"Test"}')
check "http 200" "200" "$code"

echo "4. Deuxième création avec le même nom refusée (409)"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/admin/users" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"username":"test","password":"secret123"}')
check "http 409" "409" "$code"

echo "5. GET /api/data sans token (401)"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/data")
check "http 401" "401" "$code"

echo "6. Login test, mauvais mot de passe (401)"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"username":"test","password":"wrong"}')
check "http 401" "401" "$code"

echo "7. Login test, bon mot de passe"
resp=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"username":"test","password":"secret123"}')
TOKEN2=$(echo "$resp" | jget "['token']")
check "token test non vide" "1" "$([ -n "$TOKEN2" ] && echo 1 || echo 0)"
check "isAdmin=false" "False" "$(echo "$resp" | jget "['isAdmin']")"

echo "8. PUT puis GET /api/data (compte test) reflète les données"
curl -s -X PUT "$BASE/api/data" -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" \
  -d '{"watchlist":[{"id":1,"ticker":"TEST"}],"portefeuille":[],"theses":[],"valorisations":[],"settings":{"weights":{},"thresholds":{}},"nextIds":{"watchlist":2,"portefeuille":1,"theses":1,"valorisations":1}}' > /dev/null
resp=$(curl -s -H "Authorization: Bearer $TOKEN2" "$BASE/api/data")
check "ticker=TEST" "TEST" "$(echo "$resp" | jget "['watchlist'][0]['ticker']")"

echo "9. Les données sont privées par compte (admin ne voit pas la watchlist de test)"
resp=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/data")
check "watchlist admin vide" "0" "$(echo "$resp" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['watchlist']))")"

echo "10. PUT rejette une charge > 2 Mo (413)"
python3 -c "import json; print(json.dumps({'x': 'a' * (3*1024*1024)}))" > /tmp/valueboard_oversized.json
code=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/data" -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" --data-binary @/tmp/valueboard_oversized.json)
check "http 413" "413" "$code"
rm -f /tmp/valueboard_oversized.json

echo "11. POST /api/refresh répond sans casser (pas de FINNHUB_KEY en local → tout skip)"
resp=$(curl -s -X POST "$BASE/api/refresh" -H "Authorization: Bearer $TOKEN2")
check "skipped=1 (1 titre TEST, non couvert sans clé)" "1" "$(echo "$resp" | jget "['skipped']")"

echo "12. Le compte test (non-admin) n'a pas accès à /api/admin/users (403)"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/admin/users" -H "Authorization: Bearer $TOKEN2")
check "http 403" "403" "$code"

echo "13. Promotion de test en admin"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/admin/users/test" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"isAdmin":true}')
check "http 200" "200" "$code"

echo "14. test (désormais admin) supprime le compte admin d'origine"
code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/admin/users/admin" -H "Authorization: Bearer $TOKEN2")
check "http 200" "200" "$code"

echo "15. Impossible de supprimer son propre compte"
code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/admin/users/test" -H "Authorization: Bearer $TOKEN2")
check "http 400" "400" "$code"

echo "16. Impossible de retirer le rôle admin du dernier admin restant"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/admin/users/test" -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" -d '{"isAdmin":false}')
check "http 400" "400" "$code"

echo "17. Sessions actives visibles par l'admin"
resp=$(curl -s "$BASE/api/admin/sessions" -H "Authorization: Bearer $TOKEN2")
check "au moins 1 session" "1" "$(echo "$resp" | python3 -c "import sys,json; print(1 if len(json.load(sys.stdin)['sessions'])>=1 else 0)")"

echo "18. Logout puis token révoqué"
curl -s -X POST "$BASE/api/auth/logout" -H "Authorization: Bearer $TOKEN2" > /dev/null
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN2" "$BASE/api/data")
check "http 401 après logout" "401" "$code"

echo ""
if [ "$FAIL" = "0" ]; then
  echo "✅ Tous les tests du Worker sont passés."
else
  echo "❌ Au moins un test a échoué."
fi
exit $FAIL
