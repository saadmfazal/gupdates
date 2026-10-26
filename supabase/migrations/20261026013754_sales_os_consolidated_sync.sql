-- Sales OS V4 revision 57: consolidated, evidence-backed sales workspace.
--
-- This migration is intentionally additive. It does not schedule sync, deploy
-- functions, grant new provider scopes, or mark legacy contacts as verified.
-- Provider reads remain limited to messages matching a verified contact.

create table if not exists public.sales_os_prospect_contacts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.sales_os_prospects(id) on delete cascade,
  email text not null,
  display_name text,
  role text,
  is_primary boolean not null default false,
  active boolean not null default true,
  verified_at timestamptz,
  verification_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_os_prospect_contacts_email_normalized
    check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  unique (prospect_id,email)
);

create index if not exists sales_os_prospect_contacts_verified_email_idx
  on public.sales_os_prospect_contacts(email,prospect_id)
  where active=true and verified_at is not null;

insert into public.sales_os_prospect_contacts(
  prospect_id,email,display_name,role,is_primary,active,verified_at,verification_source
)
select
  p.id,
  lower(btrim(p.contact_email)),
  nullif(btrim(p.contact_name),''),
  nullif(btrim(p.contact_role),''),
  true,
  true,
  null,
  'legacy_primary_review_required'
from public.sales_os_prospects p
where nullif(btrim(p.contact_email),'') is not null
  and lower(btrim(p.contact_email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
on conflict (prospect_id,email) do nothing;

create table if not exists public.sales_os_mail_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gmail','zoho_mail')),
  mailbox_account_id text not null,
  member_email text not null references public.sales_os_members(email) on update cascade,
  mode text not null default 'provider_read_only' check (mode='provider_read_only'),
  status text not null default 'running' check (status in ('running','success','partial','error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  coverage_started_at timestamptz,
  coverage_ended_at timestamptz,
  pages_scanned integer not null default 0,
  candidates_seen integer not null default 0,
  matched_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  review_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  checkpoint_start jsonb not null default '{}'::jsonb,
  checkpoint_end jsonb not null default '{}'::jsonb,
  detail text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists sales_os_mail_sync_runs_account_started_idx
  on public.sales_os_mail_sync_runs(provider,mailbox_account_id,started_at desc);
create unique index if not exists sales_os_mail_sync_runs_one_running_uidx
  on public.sales_os_mail_sync_runs(provider,mailbox_account_id)
  where status='running';

create table if not exists public.sales_os_mailbox_checkpoints (
  provider text not null check (provider in ('gmail','zoho_mail')),
  mailbox_account_id text not null,
  folder_key text not null,
  last_message_at timestamptz,
  last_provider_message_id text,
  cursor text,
  coverage_started_at timestamptz,
  coverage_ended_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (provider,mailbox_account_id,folder_key)
);

create table if not exists public.sales_os_mail_match_review (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gmail','zoho_mail')),
  mailbox_account_id text not null,
  provider_message_id text not null,
  provider_thread_id text,
  envelope_from text[] not null default '{}',
  envelope_to text[] not null default '{}',
  envelope_cc text[] not null default '{}',
  subject text,
  snippet text,
  sent_at timestamptz,
  reason text not null,
  candidate_prospect_ids uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','resolved','ignored')),
  sync_run_id uuid references public.sales_os_mail_sync_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution jsonb not null default '{}'::jsonb,
  unique (provider,mailbox_account_id,provider_message_id)
);

create index if not exists sales_os_mail_match_review_pending_idx
  on public.sales_os_mail_match_review(status,created_at desc)
  where status='pending';

create table if not exists public.sales_os_mail_send_attempts (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.sales_os_email_drafts(id) on delete restrict,
  provider text not null check (provider in ('gmail','zoho_mail')),
  mailbox_account_id text not null,
  member_email text not null references public.sales_os_members(email) on update cascade,
  status text not null default 'claimed' check (status in ('claimed','sent','uncertain','error')),
  provider_message_id text,
  provider_thread_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  unique (draft_id)
);

create index if not exists sales_os_mail_send_attempts_account_started_idx
  on public.sales_os_mail_send_attempts(provider,mailbox_account_id,started_at desc);

create table if not exists public.sales_os_contact_states (
  prospect_id uuid not null references public.sales_os_prospects(id) on delete cascade,
  contact_email text not null,
  engagement_status text not null default 'ready'
    check (engagement_status in ('ready','draft','sent','replied','bounced','declined','opted_out')),
  followup_blocked boolean not null default false,
  suppression_reason text,
  source_provider text,
  source_mailbox_account_id text,
  source_provider_message_id text,
  effective_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by text,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (prospect_id,contact_email),
  constraint sales_os_contact_states_email_normalized check (contact_email=lower(btrim(contact_email)))
);

create index if not exists sales_os_contact_states_blocked_idx
  on public.sales_os_contact_states(followup_blocked,engagement_status,updated_at desc);

create table if not exists public.sales_os_message_asset_links (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.sales_os_prospects(id) on delete cascade,
  email_draft_id uuid references public.sales_os_email_drafts(id) on delete cascade,
  email_message_id uuid references public.sales_os_email_messages(id) on delete cascade,
  asset_id uuid references public.sales_os_assets(id) on delete cascade,
  asset_version_id uuid references public.sales_os_asset_versions(id) on delete cascade,
  asset_deliverable_id uuid references public.sales_os_asset_deliverables(id) on delete cascade,
  relationship text not null check (relationship in ('attached','inline_visual','linked','referenced')),
  exact_url text,
  label text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text,
  constraint sales_os_message_asset_links_one_message
    check ((email_draft_id is not null)::integer + (email_message_id is not null)::integer = 1),
  constraint sales_os_message_asset_links_one_asset
    check ((asset_id is not null)::integer + (asset_version_id is not null)::integer + (asset_deliverable_id is not null)::integer = 1)
);

create index if not exists sales_os_message_asset_links_prospect_idx
  on public.sales_os_message_asset_links(prospect_id,created_at desc);
create index if not exists sales_os_message_asset_links_draft_idx
  on public.sales_os_message_asset_links(email_draft_id) where email_draft_id is not null;
create index if not exists sales_os_message_asset_links_message_idx
  on public.sales_os_message_asset_links(email_message_id) where email_message_id is not null;

alter table public.sales_os_email_messages
  add column if not exists mailbox_account_id text,
  add column if not exists provider_draft_id text,
  add column if not exists contact_email text,
  add column if not exists match_method text,
  add column if not exists delivery_state text,
  add column if not exists content_hash text,
  add column if not exists sync_run_id uuid references public.sales_os_mail_sync_runs(id) on delete set null;

create or replace function public.sales_os_fill_legacy_mailbox_account_id()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
begin
  if new.mailbox_account_id is null or btrim(new.mailbox_account_id)='' then
    new.mailbox_account_id:='legacy:'||coalesce(nullif(new.provider,''),'unknown');
  end if;
  return new;
end;
$function$;

revoke all on function public.sales_os_fill_legacy_mailbox_account_id() from public,anon,authenticated;

drop trigger if exists sales_os_email_messages_fill_mailbox_account on public.sales_os_email_messages;
create trigger sales_os_email_messages_fill_mailbox_account
before insert or update of mailbox_account_id,provider on public.sales_os_email_messages
for each row execute function public.sales_os_fill_legacy_mailbox_account_id();

update public.sales_os_email_messages
set mailbox_account_id=coalesce(
      nullif(metadata->>'mailbox_account_id',''),
      nullif(metadata->>'zoho_account',''),
      nullif(metadata->>'gmail_account',''),
      'legacy:'||provider
    ),
    match_method=coalesce(match_method,'legacy_import'),
    delivery_state=coalesce(delivery_state,case when direction='outbound' then 'sent' else null end)
where mailbox_account_id is null or match_method is null or delivery_state is null;

alter table public.sales_os_email_messages alter column mailbox_account_id set not null;

create unique index if not exists sales_os_email_messages_account_provider_id_uidx
  on public.sales_os_email_messages(provider,mailbox_account_id,provider_message_id);
create index if not exists sales_os_email_messages_prospect_sent_idx
  on public.sales_os_email_messages(prospect_id,sent_at desc);

alter table public.sales_os_inbox_thread_state
  add column if not exists mailbox_account_id text,
  add column if not exists followup_blocked boolean not null default false,
  add column if not exists sync_run_id uuid references public.sales_os_mail_sync_runs(id) on delete set null;

drop trigger if exists sales_os_inbox_thread_state_fill_mailbox_account on public.sales_os_inbox_thread_state;
create trigger sales_os_inbox_thread_state_fill_mailbox_account
before insert or update of mailbox_account_id,provider on public.sales_os_inbox_thread_state
for each row execute function public.sales_os_fill_legacy_mailbox_account_id();

update public.sales_os_inbox_thread_state
set mailbox_account_id=coalesce(mailbox_account_id,'legacy:'||provider)
where mailbox_account_id is null;

alter table public.sales_os_inbox_thread_state alter column mailbox_account_id set not null;

create unique index if not exists sales_os_inbox_thread_state_account_thread_uidx
  on public.sales_os_inbox_thread_state(provider,mailbox_account_id,provider_thread_id);

alter table public.sales_os_gmail_connections
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.sales_os_prospect_contacts enable row level security;
alter table public.sales_os_mail_sync_runs enable row level security;
alter table public.sales_os_mailbox_checkpoints enable row level security;
alter table public.sales_os_mail_match_review enable row level security;
alter table public.sales_os_mail_send_attempts enable row level security;
alter table public.sales_os_contact_states enable row level security;
alter table public.sales_os_message_asset_links enable row level security;

revoke all on table public.sales_os_prospect_contacts from public,anon,authenticated;
revoke all on table public.sales_os_mail_sync_runs from public,anon,authenticated;
revoke all on table public.sales_os_mailbox_checkpoints from public,anon,authenticated;
revoke all on table public.sales_os_mail_match_review from public,anon,authenticated;
revoke all on table public.sales_os_mail_send_attempts from public,anon,authenticated;
revoke all on table public.sales_os_contact_states from public,anon,authenticated;
revoke all on table public.sales_os_message_asset_links from public,anon,authenticated;

grant all on table public.sales_os_prospect_contacts to service_role;
grant all on table public.sales_os_mail_sync_runs to service_role;
grant all on table public.sales_os_mailbox_checkpoints to service_role;
grant all on table public.sales_os_mail_match_review to service_role;
grant all on table public.sales_os_mail_send_attempts to service_role;
grant all on table public.sales_os_contact_states to service_role;
grant all on table public.sales_os_message_asset_links to service_role;

create or replace function public.sales_os_apply_contact_state(
  p_prospect_id uuid,
  p_contact_email text,
  p_engagement_status text,
  p_source_provider text,
  p_source_mailbox_account_id text,
  p_source_provider_message_id text,
  p_effective_at timestamptz,
  p_suppression_reason text default null,
  p_metadata jsonb default '{}'::jsonb
) returns public.sales_os_contact_states
language plpgsql
security definer
set search_path to ''
as $function$
declare
  existing public.sales_os_contact_states;
  result public.sales_os_contact_states;
  normalized_email text:=lower(btrim(p_contact_email));
  new_permanent boolean:=p_engagement_status in ('bounced','declined','opted_out');
  old_permanent boolean;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'service only';
  end if;
  if p_engagement_status not in ('ready','draft','sent','replied','bounced','declined','opted_out') then
    raise exception 'invalid engagement status';
  end if;
  if normalized_email='' then
    raise exception 'contact email required';
  end if;

  -- Serialize state transitions per prospect/contact. This closes the race where
  -- a replayed outbound message could otherwise overwrite a simultaneous reply
  -- or permanent suppression before either row existed.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_prospect_id::text||':'||normalized_email,0)
  );

  select * into existing
  from public.sales_os_contact_states
  where prospect_id=p_prospect_id and contact_email=normalized_email
  for update;

  old_permanent:=existing.engagement_status in ('bounced','declined','opted_out');
  if found and old_permanent and not new_permanent then
    return existing;
  end if;
  if found and existing.engagement_status='replied' and existing.handled_at is null and not new_permanent then
    return existing;
  end if;
  if found and existing.engagement_status='replied' and existing.handled_at is not null
     and p_engagement_status='replied' and existing.effective_at>=coalesce(p_effective_at,now()) then
    return existing;
  end if;
  if found and old_permanent and new_permanent and existing.effective_at>coalesce(p_effective_at,now()) then
    return existing;
  end if;
  if found and not new_permanent and existing.effective_at>coalesce(p_effective_at,now()) then
    return existing;
  end if;

  insert into public.sales_os_contact_states(
    prospect_id,contact_email,engagement_status,followup_blocked,suppression_reason,
    source_provider,source_mailbox_account_id,source_provider_message_id,effective_at,updated_at,metadata
  ) values(
    p_prospect_id,normalized_email,p_engagement_status,
    p_engagement_status in ('replied','bounced','declined','opted_out'),
    case when new_permanent then p_suppression_reason else null end,
    p_source_provider,p_source_mailbox_account_id,p_source_provider_message_id,
    coalesce(p_effective_at,now()),now(),coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict (prospect_id,contact_email) do update
  set engagement_status=excluded.engagement_status,
      followup_blocked=excluded.followup_blocked,
      suppression_reason=excluded.suppression_reason,
      source_provider=excluded.source_provider,
      source_mailbox_account_id=excluded.source_mailbox_account_id,
      source_provider_message_id=excluded.source_provider_message_id,
      effective_at=excluded.effective_at,
      handled_at=case
        when excluded.engagement_status='replied' and excluded.effective_at>public.sales_os_contact_states.effective_at then null
        else public.sales_os_contact_states.handled_at
      end,
      handled_by=case
        when excluded.engagement_status='replied' and excluded.effective_at>public.sales_os_contact_states.effective_at then null
        else public.sales_os_contact_states.handled_by
      end,
      updated_at=now(),
      metadata=public.sales_os_contact_states.metadata||excluded.metadata
  returning * into result;
  return result;
end;
$function$;

revoke all on function public.sales_os_apply_contact_state(uuid,text,text,text,text,text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.sales_os_apply_contact_state(uuid,text,text,text,text,text,timestamptz,text,jsonb) to service_role;

create or replace function public.sales_os_mark_contact_handled(
  p_token text,
  p_prospect_id uuid,
  p_contact_email text,
  p_handled_by text
) returns public.sales_os_contact_states
language plpgsql
security definer
set search_path to ''
as $function$
declare
  result public.sales_os_contact_states;
  normalized_email text:=lower(btrim(p_contact_email));
begin
  if not public.sales_os_auth_ok(p_token) then
    raise exception 'invalid access';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_prospect_id::text||':'||normalized_email,0)
  );
  update public.sales_os_contact_states
  set followup_blocked=false,
      handled_at=now(),
      handled_by=nullif(btrim(p_handled_by),''),
      updated_at=now(),
      metadata=metadata||jsonb_build_object('handling_source','sales_os_manual_review')
  where prospect_id=p_prospect_id
    and contact_email=normalized_email
    and engagement_status='replied'
  returning * into result;
  if result.prospect_id is null then
    raise exception 'only a non-permanent reply can be marked handled';
  end if;
  return result;
end;
$function$;

revoke all on function public.sales_os_mark_contact_handled(text,uuid,text,text) from public;
grant execute on function public.sales_os_mark_contact_handled(text,uuid,text,text) to anon,authenticated,service_role;

create or replace function public.sales_os_sales_sync_snapshot(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.sales_os_auth_ok(p_token) then
    raise exception 'invalid access';
  end if;
  return jsonb_build_object(
    'prospect_contacts',coalesce((select jsonb_agg(c order by c.is_primary desc,c.created_at) from public.sales_os_prospect_contacts c),'[]'::jsonb),
    'contact_states',coalesce((select jsonb_agg(s order by s.updated_at desc) from public.sales_os_contact_states s),'[]'::jsonb),
    'sync_review_queue',coalesce((select jsonb_agg(q order by q.created_at desc) from public.sales_os_mail_match_review q where q.status='pending'),'[]'::jsonb),
    'sync_runs',coalesce((select jsonb_agg(r order by r.started_at desc) from (select * from public.sales_os_mail_sync_runs order by started_at desc limit 20) r),'[]'::jsonb),
    'send_attempts',coalesce((select jsonb_agg(a order by a.started_at desc) from (select * from public.sales_os_mail_send_attempts order by started_at desc limit 20) a),'[]'::jsonb),
    'message_asset_links',coalesce((select jsonb_agg(l order by l.created_at desc) from public.sales_os_message_asset_links l),'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.sales_os_sales_sync_snapshot(text) from public;
grant execute on function public.sales_os_sales_sync_snapshot(text) to anon,authenticated,service_role;

comment on table public.sales_os_mail_sync_runs is
  'Evidence and coverage for read-only provider scans; rows do not authorize schedules or sending.';
comment on table public.sales_os_mail_match_review is
  'Envelope-only review queue for ambiguous verified-contact matches; unrelated mailbox content is not stored.';
comment on table public.sales_os_message_asset_links is
  'Exact relationship between one draft/message and one asset/version/deliverable.';
