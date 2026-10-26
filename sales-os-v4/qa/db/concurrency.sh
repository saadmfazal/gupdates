#!/usr/bin/env bash
set -euo pipefail

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

psql --set=ON_ERROR_STOP=1 --command \
  "delete from public.sales_os_mail_sync_runs where provider='gmail' and mailbox_account_id='concurrency-account';"

psql --set=ON_ERROR_STOP=1 --command \
  "begin; insert into public.sales_os_mail_sync_runs(provider,mailbox_account_id,member_email) values ('gmail','concurrency-account','operator@example.test'); select pg_sleep(2); commit;" \
  >"$scratch/sync-owner.log" 2>&1 &
sync_owner=$!
sleep 0.25
set +e
psql --set=ON_ERROR_STOP=1 --command \
  "set lock_timeout='5s'; insert into public.sales_os_mail_sync_runs(provider,mailbox_account_id,member_email) values ('gmail','concurrency-account','operator@example.test');" \
  >"$scratch/sync-contender.log" 2>&1
sync_contender_status=$?
set -e
wait "$sync_owner"
test "$sync_contender_status" -ne 0
test "$(psql --tuples-only --no-align --command "select count(*) from public.sales_os_mail_sync_runs where provider='gmail' and mailbox_account_id='concurrency-account' and status='running';")" = "1"
echo "Concurrent sync lease: one running owner, contender rejected."

psql --set=ON_ERROR_STOP=1 --command \
  "delete from public.sales_os_mail_send_attempts where draft_id='10000000-0000-4000-8000-000000000002';"

psql --set=ON_ERROR_STOP=1 --command \
  "begin; insert into public.sales_os_mail_send_attempts(draft_id,provider,mailbox_account_id,member_email) values ('10000000-0000-4000-8000-000000000002','gmail','concurrency-account','operator@example.test'); select pg_sleep(2); commit;" \
  >"$scratch/send-owner.log" 2>&1 &
send_owner=$!
sleep 0.25
set +e
psql --set=ON_ERROR_STOP=1 --command \
  "set lock_timeout='5s'; insert into public.sales_os_mail_send_attempts(draft_id,provider,mailbox_account_id,member_email) values ('10000000-0000-4000-8000-000000000002','gmail','second-account','operator@example.test');" \
  >"$scratch/send-contender.log" 2>&1
send_contender_status=$?
set -e
wait "$send_owner"
test "$send_contender_status" -ne 0
test "$(psql --tuples-only --no-align --command "select count(*) from public.sales_os_mail_send_attempts where draft_id='10000000-0000-4000-8000-000000000002';")" = "1"
echo "Concurrent send claim: one durable owner, contender rejected."

psql --set=ON_ERROR_STOP=1 --command \
  "delete from public.sales_os_contact_states where prospect_id='00000000-0000-4000-8000-000000000005' and contact_email='concurrent@example.test';"

psql --set=ON_ERROR_STOP=1 --command \
  "begin; select public.sales_os_apply_contact_state('00000000-0000-4000-8000-000000000005','concurrent@example.test','bounced','gmail','concurrency-account','bounce-concurrent','2026-10-25T10:00:00Z','permanent_bounce','{}'::jsonb); select pg_sleep(2); commit;" \
  >"$scratch/suppression-owner.log" 2>&1 &
suppression_owner=$!
sleep 0.25
psql --set=ON_ERROR_STOP=1 --command \
  "select public.sales_os_apply_contact_state('00000000-0000-4000-8000-000000000005','concurrent@example.test','sent','gmail','concurrency-account','sent-concurrent','2026-10-26T10:00:00Z',null,'{}'::jsonb);" \
  >"$scratch/suppression-contender.log" 2>&1
wait "$suppression_owner"
test "$(psql --tuples-only --no-align --command "select engagement_status from public.sales_os_contact_states where prospect_id='00000000-0000-4000-8000-000000000005' and contact_email='concurrent@example.test';")" = "bounced"
test "$(psql --tuples-only --no-align --command "select followup_blocked from public.sales_os_contact_states where prospect_id='00000000-0000-4000-8000-000000000005' and contact_email='concurrent@example.test';")" = "t"
echo "Concurrent state transition: permanent bounce retained over later sent evidence."

echo "CONCURRENCY_ASSERTIONS_PASSED"
