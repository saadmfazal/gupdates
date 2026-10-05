-- Morpheus Sales OS MCP OAuth 2.1 / Dynamic Client Registration state.
-- These tables are private to the service-role Edge Function. No Data API
-- access is granted to anon or authenticated users.

create table if not exists public.sales_os_mcp_oauth_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris jsonb not null check (jsonb_typeof(redirect_uris) = 'array'),
  token_endpoint_auth_method text not null default 'none' check (token_endpoint_auth_method = 'none'),
  grant_types text[] not null default array['authorization_code','refresh_token']::text[],
  response_types text[] not null default array['code']::text[],
  scope text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.sales_os_mcp_oauth_codes (
  code_hash text primary key,
  client_id text not null references public.sales_os_mcp_oauth_clients(client_id) on delete restrict,
  member_email text not null,
  redirect_uri text not null,
  scope text not null,
  resource text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.sales_os_mcp_oauth_tokens (
  id uuid primary key,
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  client_id text not null references public.sales_os_mcp_oauth_clients(client_id) on delete restrict,
  member_email text not null,
  scope text not null,
  resource text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid,
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sales_os_mcp_oauth_codes_expiry_idx
  on public.sales_os_mcp_oauth_codes (expires_at)
  where used_at is null;

create index if not exists sales_os_mcp_oauth_tokens_access_expiry_idx
  on public.sales_os_mcp_oauth_tokens (access_expires_at)
  where revoked_at is null;

create index if not exists sales_os_mcp_oauth_tokens_refresh_expiry_idx
  on public.sales_os_mcp_oauth_tokens (refresh_expires_at)
  where revoked_at is null;

alter table public.sales_os_mcp_oauth_clients enable row level security;
alter table public.sales_os_mcp_oauth_codes enable row level security;
alter table public.sales_os_mcp_oauth_tokens enable row level security;

revoke all on table public.sales_os_mcp_oauth_clients from public, anon, authenticated;
revoke all on table public.sales_os_mcp_oauth_codes from public, anon, authenticated;
revoke all on table public.sales_os_mcp_oauth_tokens from public, anon, authenticated;

grant select, insert, update, delete on table public.sales_os_mcp_oauth_clients to service_role;
grant select, insert, update, delete on table public.sales_os_mcp_oauth_codes to service_role;
grant select, insert, update, delete on table public.sales_os_mcp_oauth_tokens to service_role;

create or replace function public.sales_os_mcp_redeem_code(
  p_code_hash text,
  p_client_id text,
  p_redirect_uri text,
  p_code_challenge text,
  p_resource text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_email text;
  v_scope text;
  v_resource text;
begin
  update public.sales_os_mcp_oauth_codes
  set used_at = now()
  where code_hash = p_code_hash
    and client_id = p_client_id
    and redirect_uri = p_redirect_uri
    and code_challenge = p_code_challenge
    and resource = p_resource
    and used_at is null
    and expires_at > now()
  returning member_email, scope, resource
    into v_member_email, v_scope, v_resource;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'member_email', v_member_email,
    'scope', v_scope,
    'resource', v_resource
  );
end;
$$;

revoke all on function public.sales_os_mcp_redeem_code(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.sales_os_mcp_redeem_code(text,text,text,text,text) to service_role;

create or replace function public.sales_os_mcp_rotate_refresh(
  p_refresh_hash text,
  p_client_id text,
  p_resource text,
  p_new_id uuid,
  p_new_access_hash text,
  p_new_refresh_hash text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_email text;
  v_scope text;
begin
  update public.sales_os_mcp_oauth_tokens
  set revoked_at = now(),
      last_refreshed_at = now(),
      replaced_by = p_new_id
  where refresh_token_hash = p_refresh_hash
    and client_id = p_client_id
    and resource = p_resource
    and revoked_at is null
    and refresh_expires_at > now()
  returning member_email, scope
    into v_member_email, v_scope;

  if not found then
    return null;
  end if;

  insert into public.sales_os_mcp_oauth_tokens (
    id, access_token_hash, refresh_token_hash, client_id, member_email,
    scope, resource, access_expires_at, refresh_expires_at
  ) values (
    p_new_id, p_new_access_hash, p_new_refresh_hash, p_client_id, v_member_email,
    v_scope, p_resource, p_access_expires_at, p_refresh_expires_at
  );

  return jsonb_build_object(
    'member_email', v_member_email,
    'scope', v_scope,
    'resource', p_resource
  );
end;
$$;

revoke all on function public.sales_os_mcp_rotate_refresh(text,text,text,uuid,text,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.sales_os_mcp_rotate_refresh(text,text,text,uuid,text,text,timestamptz,timestamptz) to service_role;

comment on table public.sales_os_mcp_oauth_clients is 'Dynamically registered public OAuth clients for Morpheus Sales OS MCP.';
comment on table public.sales_os_mcp_oauth_codes is 'Single-use, PKCE-bound OAuth authorization codes for Morpheus Sales OS MCP.';
comment on table public.sales_os_mcp_oauth_tokens is 'Hashed, audience-bound OAuth access and rotating refresh tokens for Morpheus Sales OS MCP.';
