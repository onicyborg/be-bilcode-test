#!/usr/bin/env bash
set -euo pipefail
export IMAGE="$1"
docker network inspect siklus >/dev/null 2>&1 || docker network create siklus >/dev/null
docker compose pull api
docker compose run --rm api pnpm exec prisma migrate deploy
docker compose up -d --remove-orphans api
container=$(docker compose ps -q api)
for attempt in $(seq 1 60); do
  if docker exec "$container" node -e "fetch('http://127.0.0.1:3001/api/docs/openapi.json').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then exit 0; fi
  sleep 5
done
echo 'Service readiness failed; inspect container logs on the VPS.' >&2
exit 1
