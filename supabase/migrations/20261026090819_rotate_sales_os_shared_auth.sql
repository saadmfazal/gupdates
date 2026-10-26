-- Prepare active-member and service-role authentication before the exposed
-- shared code is rotated. Keeping preparation and rotation separate prevents
-- member lockout during the edge-function and web-client cutover.

create table if not exists public.sales_os_auth_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  email_hash text not null,
  ip_hash text not null,
  requested_at timestamptz not null default pg_catalog.now(),
  allowed boolean not null default false
);

create index if not exists sales_os_auth_requests_email_time_idx
  on public.sales_os_auth_requests(email_hash,requested_at desc);
create index if not exists sales_os_auth_requests_ip_time_idx
  on public.sales_os_auth_requests(ip_hash,requested_at desc);
create index if not exists sales_os_auth_requests_cleanup_idx
  on public.sales_os_auth_requests(requested_at);

alter table public.sales_os_auth_requests enable row level security;
revoke all on table public.sales_os_auth_requests from public,anon,authenticated;
grant select,insert,delete on table public.sales_os_auth_requests to service_role;

create or replace function public.sales_os_allow_member_login(
  p_email text,
  p_email_hash text,
  p_ip_hash text
) returns boolean
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_email text:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,'')));
  v_member boolean:=false;
  v_email_recent integer:=0;
  v_ip_recent integer:=0;
  v_allowed boolean:=false;
begin
  if p_email_hash is null or pg_catalog.length(p_email_hash)<>64
     or p_ip_hash is null or pg_catalog.length(p_ip_hash)<>64 then
    return false;
  end if;

  -- Every caller takes the same two locks in the same order so simultaneous
  -- attempts cannot race past either limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sales_os_login_email:'||p_email_hash,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sales_os_login_ip:'||p_ip_hash,0)
  );

  select pg_catalog.count(*) into v_email_recent
  from public.sales_os_auth_requests
  where email_hash=p_email_hash
    and requested_at>=pg_catalog.now()-interval '15 minutes';

  select pg_catalog.count(*) into v_ip_recent
  from public.sales_os_auth_requests
  where ip_hash=p_ip_hash
    and requested_at>=pg_catalog.now()-interval '15 minutes';

  select exists (
    select 1
    from public.sales_os_members m
    where m.active=true and pg_catalog.lower(m.email)=v_email
  ) into v_member;

  v_allowed:=v_member and v_email_recent<3 and v_ip_recent<10;

  insert into public.sales_os_auth_requests(email_hash,ip_hash,allowed)
  values (p_email_hash,p_ip_hash,v_allowed);

  delete from public.sales_os_auth_requests
  where requested_at<pg_catalog.now()-interval '7 days';

  return v_allowed;
end;
$function$;

revoke all on function public.sales_os_allow_member_login(text,text,text) from public,anon,authenticated;
grant execute on function public.sales_os_allow_member_login(text,text,text) to service_role;

comment on table public.sales_os_auth_requests is
  'Hashed, short-lived request evidence for Sales OS member magic-link abuse controls.';
comment on function public.sales_os_allow_member_login(text,text,text) is
  'Service-only active-member gate with three-per-email and ten-per-IP limits per fifteen minutes.';

create or replace function public.sales_os_auth_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    coalesce(auth.jwt()->>'role','')='service_role'
    or exists (
      select 1
      from public.sales_os_members m
      where m.active=true
        and pg_catalog.lower(m.email)=pg_catalog.lower(coalesce(auth.jwt()->>'email',''))
    )
    or (
      p_token is not null
      and exists (
        select 1
        from public.sales_os_config c
        where c.key='team_access_sha256'
          and c.value=pg_catalog.encode(
            extensions.digest(pg_catalog.convert_to(p_token,'UTF8'),'sha256'),
            'hex'
          )
      )
    )
$function$;

comment on function public.sales_os_auth_ok(text) is
  'Sales OS authorization: active member JWT, service-role backend JWT, or the current Vault-backed recovery code digest.';
