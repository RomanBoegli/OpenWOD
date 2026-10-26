#!/usr/bin/env sh
# Rehearses the documented backup and restore (DAT-07, DEP-13) against a throwaway stack built from source:
# save a workout, download a consistent backup, destroy the stack and its volume, bring an empty stack up,
# copy the backup into the volume, start, and check the workout is back. Exits non-zero on any mismatch.
set -eu
PROJECT=openwod-rehearsal
COMPOSE="docker compose -p $PROJECT -f deploy/compose.dev.yaml"
PORT="${HTTP_PORT:-8089}"
BASE="http://127.0.0.1:$PORT/api/v1"
WORK="$(mktemp -d)"
trap 'HTTP_PORT=$PORT $COMPOSE down -v >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

wait_ready() {
  for _ in $(seq 1 60); do
    if curl --fail --silent "$BASE/health/ready" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "The server did not become ready." >&2
  exit 1
}

echo "1. Build and start a fresh stack on port $PORT"
HTTP_PORT=$PORT $COMPOSE up --build -d >/dev/null
wait_ready

echo "2. Save a workout through the API"
cat > "$WORK/workout.json" <<JSON
{"document":{"schemaVersion":2,"id":"rehearsal","revision":1,"title":"Rehearsal","equipment":[],"participants":1,"prepMs":10000,"sections":[{"id":"s","title":"Main","format":"timedCircuit","transitionAfter":"manualReady","body":{"id":"seq","type":"sequence","children":[{"id":"t","type":"timed","durationMs":30000,"assignments":{"A":{"name":"Burpees"}}}]}}]}}
JSON
curl --fail --silent -X PUT -H 'content-type: application/json' --data @"$WORK/workout.json" "$BASE/workouts/rehearsal" >/dev/null

echo "3. Download a consistent backup while the server runs"
curl --fail --silent -o "$WORK/backup.sqlite" "$BASE/backup"
test -s "$WORK/backup.sqlite"

echo "4. Destroy the stack and its volume, then start an empty one"
HTTP_PORT=$PORT $COMPOSE down -v >/dev/null
HTTP_PORT=$PORT $COMPOSE up -d >/dev/null
wait_ready
COUNT="$(curl --fail --silent "$BASE/workouts" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).workouts.length))')"
test "$COUNT" = "0"

echo "5. Restore the backup into the volume with the server stopped"
HTTP_PORT=$PORT $COMPOSE stop >/dev/null
docker run --rm -v "${PROJECT}_openwod-data:/data" -v "$WORK:/in" alpine sh -c 'rm -f /data/app.sqlite /data/app.sqlite-wal /data/app.sqlite-shm && cp /in/backup.sqlite /data/app.sqlite && chown 1000:1000 /data/app.sqlite'
HTTP_PORT=$PORT $COMPOSE start >/dev/null
wait_ready

echo "6. Check the workout is back"
TITLE="$(curl --fail --silent "$BASE/workouts/rehearsal" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).document.title))')"
test "$TITLE" = "Rehearsal"
echo "Restore rehearsal passed: the workout survived backup, volume loss and restore."
