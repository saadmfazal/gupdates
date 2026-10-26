\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $roles$
begin
  begin create role anon nologin; exception when duplicate_object then null; end;
  begin create role authenticated nologin; exception when duplicate_object then null; end;
  begin create role service_role nologin bypassrls; exception when duplicate_object then null; end;
end;
$roles$;

grant usage on schema public to anon, authenticated, service_role;

create table public.sales_os_members (
  email text primary key
);

create table public.sales_os_prospects (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_email text,
  contact_name text,
  contact_role text
);

create table public.sales_os_email_drafts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references public.sales_os_prospects(id)
);

create table public.sales_os_email_messages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references public.sales_os_prospects(id),
  provider text not null,
  provider_message_id text not null,
  provider_thread_id text,
  direction text not null check (direction in ('inbound','outbound')),
  subject text,
  sent_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint sales_os_email_messages_provider_message_key unique (provider, provider_message_id)
);

create table public.sales_os_inbox_thread_state (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_thread_id text not null,
  prospect_id uuid references public.sales_os_prospects(id),
  updated_at timestamptz not null default now(),
  constraint sales_os_inbox_thread_state_provider_thread_key unique (provider, provider_thread_id)
);

create table public.sales_os_gmail_connections (
  member_email text primary key references public.sales_os_members(email)
);

create table public.sales_os_assets (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references public.sales_os_prospects(id)
);

create table public.sales_os_asset_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.sales_os_assets(id)
);

create table public.sales_os_asset_deliverables (
  id uuid primary key default gen_random_uuid(),
  asset_version_id uuid references public.sales_os_asset_versions(id)
);

create or replace function public.sales_os_auth_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select p_token='fixture-token'
$function$;

revoke all on function public.sales_os_auth_ok(text) from public;
grant execute on function public.sales_os_auth_ok(text) to anon, authenticated, service_role;

insert into public.sales_os_members(email) values ('operator@example.test');

insert into public.sales_os_prospects(id,company_name,contact_email,contact_name,contact_role) values
  ('00000000-0000-4000-8000-000000000001','Legacy Pilot','legacy@example.test','Legacy Contact','Buyer'),
  ('00000000-0000-4000-8000-000000000002','OOO Pilot','ooo@example.test','OOO Contact','Buyer'),
  ('00000000-0000-4000-8000-000000000003','Opt-out Pilot','optout@example.test','Opt-out Contact','Buyer'),
  ('00000000-0000-4000-8000-000000000004','Decline Pilot','decline@example.test','Decline Contact','Buyer'),
  ('00000000-0000-4000-8000-000000000005','Concurrent Pilot','concurrent@example.test','Concurrent Contact','Buyer');

insert into public.sales_os_email_drafts(id,prospect_id) values
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005');

insert into public.sales_os_email_messages(
  id,prospect_id,provider,provider_message_id,provider_thread_id,direction,subject,sent_at,metadata
) values
  ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','gmail','legacy-with-account','thread-a','outbound','Synthetic legacy message','2026-10-01T10:00:00Z','{"mailbox_account_id":"fixture-account"}'::jsonb),
  ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','gmail','legacy-without-account','thread-b','outbound','Synthetic legacy fallback','2026-10-01T11:00:00Z','{}'::jsonb);

insert into public.sales_os_inbox_thread_state(
  id,provider,provider_thread_id,prospect_id
) values (
  '30000000-0000-4000-8000-000000000001','gmail','legacy-thread','00000000-0000-4000-8000-000000000001'
);

insert into public.sales_os_gmail_connections(member_email) values ('operator@example.test');
