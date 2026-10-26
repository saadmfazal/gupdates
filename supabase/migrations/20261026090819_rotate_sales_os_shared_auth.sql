-- Rotate the exposed Sales OS team access code without placing the replacement
-- in source, migration history, logs, or client code. The new code is created
-- inside Postgres, encrypted by Vault at rest, and only its digest is retained
-- in the Sales OS configuration table.

do $sales_os_team_access_rotation$
declare
  v_secret text;
  v_secret_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales_os_team_access_rotation',0));

  v_secret := pg_catalog.encode(extensions.gen_random_bytes(32),'hex');

  select id
  into v_secret_id
  from vault.secrets
  where name='sales_os_team_access_token'
  for update;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      v_secret,
      'sales_os_team_access_token',
      'Server-generated Sales OS shared access recovery secret; never expose to browser clients.',
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_secret,
      'sales_os_team_access_token',
      'Server-generated Sales OS shared access recovery secret; never expose to browser clients.',
      null
    );
  end if;

  insert into public.sales_os_config(key,value,updated_at)
  values (
    'team_access_sha256',
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_secret,'UTF8'),'sha256'),'hex'),
    pg_catalog.now()
  )
  on conflict (key) do update
  set value=excluded.value,
      updated_at=excluded.updated_at;
end;
$sales_os_team_access_rotation$;

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

