#!/bin/bash
# Test d'intégration du Worker : démarre wrangler dev sur un port dédié,
# rejoue le scénario auth/data complet, vérifie chaque réponse, puis arrête.
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
  if curl -s -o /dev/null "$BASE/api/auth/account"; then break; fi
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

echo "1. Compte inexistant au départ"
resp=$(curl -s "$BASE/api/auth/account")
check "exists=false" '{"exists":false}' "$resp"

echo "2. Création de compte"
resp=$(curl -s -X POST "$BASE/api/auth/setup" -H "Content-Type: application/json" -d '{"username":"test","password":"secret123"}')
TOKEN=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
check "token non vide" "1" "$([ -n "$TOKEN" ] && echo 1 || echo 0)"

echo "3. Compte existe maintenant"
resp=$(curl -s "$BASE/api/auth/account")
check "exists=true" '{"exists":true}' "$resp"

echo "4. Deuxième setup refusé (409)"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/setup" -H "Content-Type: application/json" -d '{"username":"x","password":"y"}')
check "http 409" "409" "$code"

echo "5. GET /api/data sans token (401)"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/data")
check "http 401" "401" "$code"

echo "6. Login mauvais mot de passe (401)"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"username":"test","password":"wrong"}')
check "http 401" "401" "$code"

echo "7. Login bon mot de passe"
resp=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"username":"test","password":"secret123"}')
TOKEN2=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
check "nouveau token non vide" "1" "$([ -n "$TOKEN2" ] && echo 1 || echo 0)"

echo "8. PUT puis GET /api/data reflète les données"
curl -s -X PUT "$BASE/api/data" -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" \
  -d '{"watchlist":[{"id":1,"ticker":"TEST"}],"portefeuille":[],"theses":[],"valorisations":[],"settings":{"weights":{},"thresholds":{}},"nextIds":{"watchlist":2,"portefeuille":1,"theses":1,"valorisations":1}}' > /dev/null
resp=$(curl -s -H "Authorization: Bearer $TOKEN2" "$BASE/api/data" | python3 -c "import sys,json; print(json.load(sys.stdin)['watchlist'][0]['ticker'])")
check "ticker=TEST" "TEST" "$resp"

echo "9. PUT rejette une charge > 2 Mo (413)"
python3 -c "import json; print(json.dumps({'x': 'a' * (3*1024*1024)}))" > /tmp/valueboard_oversized.json
code=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/data" -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" --data-binary @/tmp/valueboard_oversized.json)
check "http 413" "413" "$code"
rm -f /tmp/valueboard_oversized.json

echo "10. POST /api/refresh répond sans casser (pas de FINNHUB_KEY en local → tout skip)"
resp=$(curl -s -X POST "$BASE/api/refresh" -H "Authorization: Bearer $TOKEN2")
skipped=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['skipped'])")
check "skipped=1 (1 titre TEST, non couvert sans clé)" "1" "$skipped"

echo "11. Logout puis token révoqué"
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
