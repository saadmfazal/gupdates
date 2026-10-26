#!/usr/bin/env bash
set -euo pipefail

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

psql --set=ON_ERROR_STOP=1 --command \
  "delete from public.sales_os_auth_requests where email_hash=repeat('e',64) and ip_hash=repeat('f',64);"

pids=()
for attempt in 1 2 3 4; do
  psql --set=ON_ERROR_STOP=1 --tuples-only --no-align --command \
    "set role service_role; select public.sales_os_allow_member_login('operator@example.test',repeat('e',64),repeat('f',64));" \
    >"$scratch/rate-$attempt.log" 2>&1 &
  pids+=("$!")
done

for pid in "${pids[@]}"; do wait "$pid"; done

test "$(psql --tuples-only --no-align --command "select count(*) from public.sales_os_auth_requests where email_hash=repeat('e',64) and ip_hash=repeat('f',64);")" = "4"
test "$(psql --tuples-only --no-align --command "select count(*) from public.sales_os_auth_requests where email_hash=repeat('e',64) and ip_hash=repeat('f',64) and allowed;")" = "3"

echo "Concurrent member login throttle: three allowed, fourth denied."
echo "AUTH_CONCURRENCY_ASSERTIONS_PASSED"
