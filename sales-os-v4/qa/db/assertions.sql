\set ON_ERROR_STOP on

create schema if not exists test_support;

create or replace function test_support.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $function$
begin
  if coalesce(p_condition,false)=false then
    raise exception 'assertion failed: %',p_message;
  end if;
end;
$function$;

select test_support.assert_true(
  (select count(*)=7 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in (
     'sales_os_prospect_contacts','sales_os_mail_sync_runs','sales_os_mailbox_checkpoints',
     'sales_os_mail_match_review','sales_os_mail_send_attempts','sales_os_contact_states',
     'sales_os_message_asset_links'
   )),
  'all consolidation tables exist'
);

select test_support.assert_true(
  not exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (
      'sales_os_prospect_contacts','sales_os_mail_sync_runs','sales_os_mailbox_checkpoints',
      'sales_os_mail_match_review','sales_os_mail_send_attempts','sales_os_contact_states',
      'sales_os_message_asset_links'
    ) and not c.relrowsecurity
  ),
  'RLS is enabled on every consolidation table'
);

select test_support.assert_true(
  not exists (
    select 1
    from unnest(array[
      'sales_os_prospect_contacts','sales_os_mail_sync_runs','sales_os_mailbox_checkpoints',
      'sales_os_mail_match_review','sales_os_mail_send_attempts','sales_os_contact_states',
      'sales_os_message_asset_links'
    ]) as t(name)
    where has_table_privilege('anon','public.'||t.name,'select')
       or has_table_privilege('authenticated','public.'||t.name,'select')
       or has_table_privilege('anon','public.'||t.name,'insert')
       or has_table_privilege('authenticated','public.'||t.name,'insert')
  ),
  'anon and authenticated have no direct consolidation-table access'
);

select test_support.assert_true(
  not exists (
    select 1
    from unnest(array[
      'sales_os_prospect_contacts','sales_os_mail_sync_runs','sales_os_mailbox_checkpoints',
      'sales_os_mail_match_review','sales_os_mail_send_attempts','sales_os_contact_states',
      'sales_os_message_asset_links'
    ]) as t(name)
    where not has_table_privilege('service_role','public.'||t.name,'select,insert,update,delete')
  ),
  'service role has required consolidation-table access'
);

select test_support.assert_true(
  exists (
    select 1 from public.sales_os_prospect_contacts
    where prospect_id='00000000-0000-4000-8000-000000000001'
      and email='legacy@example.test'
      and verified_at is null
      and verification_source='legacy_primary_review_required'
  ),
  'legacy contacts are backfilled but remain unverified'
);

select test_support.assert_true(
  (select mailbox_account_id='fixture-account' and match_method='legacy_import' and delivery_state='sent'
   from public.sales_os_email_messages where provider_message_id='legacy-with-account'),
  'legacy message metadata backfills account scope and sent evidence'
);

select test_support.assert_true(
  (select mailbox_account_id='legacy:gmail'
   from public.sales_os_email_messages where provider_message_id='legacy-without-account'),
  'legacy message fallback account is explicit'
);

insert into public.sales_os_email_messages(
  id,prospect_id,provider,provider_message_id,provider_thread_id,direction,subject,sent_at,metadata,mailbox_account_id
) values (
  '20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',
  'gmail','post-migration-legacy-writer','thread-c','inbound','Synthetic trigger check','2026-10-02T10:00:00Z','{}'::jsonb,null
);

select test_support.assert_true(
  (select mailbox_account_id='legacy:gmail' from public.sales_os_email_messages where provider_message_id='post-migration-legacy-writer'),
  'compatibility trigger protects legacy message writers'
);

select test_support.assert_true(
  (select mailbox_account_id='legacy:gmail' from public.sales_os_inbox_thread_state where provider_thread_id='legacy-thread'),
  'compatibility trigger/backfill protects legacy thread writers'
);

select test_support.assert_true(
  exists (select 1 from pg_catalog.pg_indexes where schemaname='public' and indexname='sales_os_email_messages_account_provider_id_uidx'
          and indexdef like '%provider, mailbox_account_id, provider_message_id%'),
  'message dedupe index contains mailbox account scope'
);

insert into public.sales_os_mailbox_checkpoints(provider,mailbox_account_id,folder_key) values
  ('gmail','account-a','inbox'),
  ('gmail','account-b','inbox');

select test_support.assert_true(
  (select count(*)=2 from public.sales_os_mailbox_checkpoints where provider='gmail' and folder_key='inbox'),
  'checkpoint identity allows the same folder for separate mailbox accounts'
);

do $expect_checkpoint_duplicate$
declare failed_as_expected boolean:=false;
begin
  begin
    insert into public.sales_os_mailbox_checkpoints(provider,mailbox_account_id,folder_key)
    values ('gmail','account-a','inbox');
  exception when unique_violation then
    failed_as_expected:=true;
  end;
  if not failed_as_expected then
    raise exception 'assertion failed: same-account checkpoint replay was not deduplicated';
  end if;
end;
$expect_checkpoint_duplicate$;

select test_support.assert_true(
  exists (select 1 from pg_catalog.pg_constraint where conname='sales_os_email_messages_provider_message_key'),
  'legacy message uniqueness remains present for explicit later cleanup'
);

select test_support.assert_true(
  exists (select 1 from pg_catalog.pg_constraint where conname='sales_os_inbox_thread_state_provider_thread_key'),
  'legacy thread uniqueness remains present for explicit later cleanup'
);

select test_support.assert_true(
  not has_function_privilege('anon','public.sales_os_apply_contact_state(uuid,text,text,text,text,text,timestamptz,text,jsonb)','execute')
  and has_function_privilege('service_role','public.sales_os_apply_contact_state(uuid,text,text,text,text,text,timestamptz,text,jsonb)','execute'),
  'state transition RPC is service-only'
);

select test_support.assert_true(
  has_function_privilege('anon','public.sales_os_mark_contact_handled(text,uuid,text,text)','execute')
  and has_function_privilege('authenticated','public.sales_os_sales_sync_snapshot(text)','execute'),
  'narrow member RPC grants are present'
);

select test_support.assert_true(
  not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('sales_os_apply_contact_state','sales_os_mark_contact_handled','sales_os_sales_sync_snapshot')
      and (not p.prosecdef or coalesce(array_to_string(p.proconfig,','),'') not like '%search_path=""%')
  ),
  'security-definer RPCs pin an empty search_path'
);

select public.sales_os_apply_contact_state(
  '00000000-0000-4000-8000-000000000002','ooo@example.test','sent','gmail','fixture-account','sent-ooo',
  '2026-10-20T10:00:00Z',null,'{"fixture":true}'::jsonb
);
select public.sales_os_apply_contact_state(
  '00000000-0000-4000-8000-000000000002','ooo@example.test','replied','gmail','fixture-account','ooo-reply',
  '2026-10-21T10:00:00Z',null,'{"classification":"out_of_office"}'::jsonb
);

select test_support.assert_true(
  (select engagement_status='replied' and followup_blocked and metadata->>'classification'='out_of_office'
   from public.sales_os_contact_states
   where prospect_id='00000000-0000-4000-8000-000000000002' and contact_email='ooo@example.test'),
  'out-of-office is a reply requiring individual handling'
);

select public.sales_os_apply_contact_state(
  '00000000-0000-4000-8000-000000000002','ooo@example.test','sent','gmail','fixture-account','later-sent',
  '2026-10-22T10:00:00Z',null,'{}'::jsonb
);
select test_support.assert_true(
  (select engagement_status='replied' and followup_blocked from public.sales_os_contact_states
   where prospect_id='00000000-0000-4000-8000-000000000002' and contact_email='ooo@example.test'),
  'later outbound evidence cannot clear an unhandled reply'
);

set role anon;
select public.sales_os_mark_contact_handled('fixture-token','00000000-0000-4000-8000-000000000002','ooo@example.test','synthetic-reviewer');
select public.sales_os_sales_sync_snapshot('fixture-token');
reset role;

select test_support.assert_true(
  (select engagement_status='replied' and not followup_blocked and handled_at is not null
   from public.sales_os_contact_states
   where prospect_id='00000000-0000-4000-8000-000000000002' and contact_email='ooo@example.test'),
  'manual handling releases only the reply pause'
);

select public.sales_os_apply_contact_state(
  '00000000-0000-4000-8000-000000000002','ooo@example.test','replied','gmail','fixture-account','ooo-reply',
  '2026-10-21T10:00:00Z',null,'{"replayed":true}'::jsonb
);
select test_support.assert_true(
  (select not followup_blocked and handled_at is not null from public.sales_os_contact_states
   where prospect_id='00000000-0000-4000-8000-000000000002' and contact_email='ooo@example.test'),
  'replayed handled reply remains handled'
);

select public.sales_os_apply_contact_state(
  '00000000-0000-4000-8000-000000000002','ooo@example.test','replied','gmail','fixture-account','new-reply',
  '2026-10-23T10:00:00Z',null,'{}'::jsonb
);
select test_support.assert_true(
  (select followup_blocked and handled_at is null from public.sales_os_contact_states
   where prospect_id='00000000-0000-4000-8000-000000000002' and contact_email='ooo@example.test'),
  'a genuinely newer reply requires handling again'
);

select public.sales_os_apply_contact_state(
  '00000000-0000-4000-8000-000000000003','optout@example.test','opted_out','gmail','fixture-account','optout-1',
  '2026-10-21T12:00:00Z','opt_out','{}'::jsonb
);
select public.sales_os_apply_contact_state(
  '00000000-0000-4000-8000-000000000003','optout@example.test','sent','gmail','fixture-account','sent-after-optout',
  '2026-10-24T12:00:00Z',null,'{}'::jsonb
);
select public.sales_os_apply_contact_state(
  '00000000-0000-4000-8000-000000000004','decline@example.test','declined','zoho_mail','fixture-account','decline-1',
  '2026-10-21T13:00:00Z','declined','{}'::jsonb
);

select test_support.assert_true(
  (select engagement_status='opted_out' and followup_blocked and suppression_reason='opt_out'
   from public.sales_os_contact_states where prospect_id='00000000-0000-4000-8000-000000000003'),
  'opt-out suppression cannot be revived by imports'
);
select test_support.assert_true(
  (select engagement_status='declined' and followup_blocked
   from public.sales_os_contact_states where prospect_id='00000000-0000-4000-8000-000000000004'),
  'decline is permanent suppression'
);

do $expect_permanent_handle_failure$
declare failed_as_expected boolean:=false;
begin
  begin
    perform public.sales_os_mark_contact_handled(
      'fixture-token','00000000-0000-4000-8000-000000000003','optout@example.test','synthetic-reviewer'
    );
  exception when others then
    failed_as_expected:=position('only a non-permanent reply' in sqlerrm)>0;
  end;
  if not failed_as_expected then
    raise exception 'assertion failed: permanent suppression was marked handled';
  end if;
end;
$expect_permanent_handle_failure$;

select test_support.assert_true(
  (select count(*)=0 from information_schema.role_table_grants
   where grantee in ('anon','authenticated')
     and table_schema='public'
     and table_name like 'sales_os_mail%'),
  'catalog advisor: no broad mailbox table grants'
);

select 'SQL_ASSERTIONS_PASSED' as result;
