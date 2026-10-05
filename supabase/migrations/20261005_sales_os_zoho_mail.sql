-- Morpheus Sales OS: governed Zoho Mail bridge.
-- Sales OS remains authoritative; Zoho is an external message provider.

create table if not exists public.sales_os_zoho_connections (
  member_email text primary key references public.sales_os_members(email) on update cascade,
  zoho_email text,
  account_id text,
  accounts_domain text not null default 'https://accounts.zoho.com',
  mail_api_domain text not null default 'https://mail.zoho.com',
  secret_name text,
  scopes text[] not null default '{}',
  active boolean not null default true,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_detail text,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.sales_os_zoho_oauth_states (
  state text primary key,
  member_email text not null references public.sales_os_members(email) on update cascade,
  accounts_domain text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sales_os_zoho_oauth_states_member_expiry_idx
  on public.sales_os_zoho_oauth_states(member_email,expires_at);

alter table public.sales_os_zoho_connections enable row level security;
alter table public.sales_os_zoho_oauth_states enable row level security;

revoke all on table public.sales_os_zoho_connections from anon, authenticated;
revoke all on table public.sales_os_zoho_oauth_states from anon, authenticated;
grant all on table public.sales_os_zoho_connections to service_role;
grant all on table public.sales_os_zoho_oauth_states to service_role;

insert into public.sales_os_connections(key,label,kind,status,account_label,metadata,updated_at)
values(
  'zoho_mail',
  'Zoho Mail',
  'email',
  'not_configured',
  null,
  jsonb_build_object(
    'authority','Sales OS',
    'mode','matched_prospect_threads_only',
    'send_gate','human_review_required'
  ),
  now()
)
on conflict (key) do update
set label=excluded.label,
    kind=excluded.kind,
    metadata=coalesce(public.sales_os_connections.metadata,'{}'::jsonb)||excluded.metadata;

create or replace function public.sales_os_store_zoho_secret(
  p_member_email text,
  p_refresh_token text
) returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  secret_name text;
  sid uuid;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'service only';
  end if;
  if length(coalesce(p_refresh_token,'')) < 20 then
    raise exception 'refresh token looks invalid';
  end if;

  secret_name:='sales_os_zoho_refresh_'||encode(extensions.digest(lower(p_member_email),'sha256'),'hex');
  select id into sid from vault.secrets where name=secret_name limit 1;
  if sid is null then
    perform vault.create_secret(p_refresh_token,secret_name,'Morpheus Sales OS Zoho refresh token');
  else
    perform vault.update_secret(sid,p_refresh_token,secret_name,'Morpheus Sales OS Zoho refresh token');
  end if;
  return secret_name;
end;
$function$;

create or replace function public.sales_os_get_zoho_secret(
  p_member_email text
) returns text
language sql
security definer
set search_path to ''
as $function$
  select d.decrypted_secret
  from public.sales_os_zoho_connections c
  join vault.decrypted_secrets d on d.name=c.secret_name
  where lower(c.member_email)=lower(p_member_email)
    and c.active=true
  limit 1
$function$;

revoke all on function public.sales_os_store_zoho_secret(text,text) from public, anon, authenticated;
revoke all on function public.sales_os_get_zoho_secret(text) from public, anon, authenticated;
grant execute on function public.sales_os_store_zoho_secret(text,text) to service_role;
grant execute on function public.sales_os_get_zoho_secret(text) to service_role;

create or replace function public.sales_os_zoho_status(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.sales_os_auth_ok(p_token) then
    raise exception 'invalid access';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'member_email',c.member_email,
      'zoho_email',c.zoho_email,
      'account_id',c.account_id,
      'accounts_domain',c.accounts_domain,
      'mail_api_domain',c.mail_api_domain,
      'scopes',c.scopes,
      'active',c.active,
      'last_sync_at',c.last_sync_at,
      'last_sync_status',c.last_sync_status,
      'last_sync_detail',c.last_sync_detail,
      'connected_at',c.connected_at,
      'updated_at',c.updated_at
    ) order by c.member_email)
    from public.sales_os_zoho_connections c
  ),'[]'::jsonb);
end;
$function$;

revoke all on function public.sales_os_zoho_status(text) from public;
grant execute on function public.sales_os_zoho_status(text) to anon, authenticated, service_role;

create or replace function public.sales_os_store_secret(
  p_token text,
  p_name text,
  p_secret text
) returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor jsonb;
  sid uuid;
  min_length integer;
  provider_label text;
  zoho_ready boolean;
begin
  if p_name not in (
    'sales_os_openai_api_key',
    'sales_os_zoho_client_id',
    'sales_os_zoho_client_secret'
  ) then
    raise exception 'secret name not allowed';
  end if;

  min_length:=case when p_name='sales_os_zoho_client_id' then 10 else 20 end;
  if length(coalesce(p_secret,'')) < min_length then
    raise exception 'secret looks invalid';
  end if;

  actor:=public.sales_os_actor(p_token);
  if actor is null or coalesce((actor->>'authenticated')::boolean,false)=false then
    raise exception 'named Sales OS member sign-in required';
  end if;

  select id into sid from vault.secrets where name=p_name limit 1;
  if sid is null then
    perform vault.create_secret(p_secret,p_name,'Morpheus Sales OS server secret');
  else
    perform vault.update_secret(sid,p_secret,p_name,'Morpheus Sales OS server secret');
  end if;

  provider_label:=case when p_name like 'sales_os_zoho_%' then 'Zoho Mail' else 'Morpheus AI' end;

  if p_name like 'sales_os_zoho_%' then
    select
      exists(select 1 from vault.secrets where name='sales_os_zoho_client_id') and
      exists(select 1 from vault.secrets where name='sales_os_zoho_client_secret')
    into zoho_ready;

    update public.sales_os_connections
    set status=case when zoho_ready then 'ready_to_connect' else 'setup_required' end,
        updated_at=now()
    where key='zoho_mail' and status<>'connected';
  end if;

  insert into public.sales_os_audit_log(
    actor_email,actor_name,actor_role,action,entity_type,entity_id,summary,source
  ) values(
    actor->>'email',actor->>'display_name','member','connect_provider','sales_os_secret',p_name,
    'Configured '||provider_label||' credentials','settings'
  );
  return true;
end;
$function$;

revoke all on function public.sales_os_store_secret(text,text,text) from public;
grant execute on function public.sales_os_store_secret(text,text,text) to anon, authenticated, service_role;
