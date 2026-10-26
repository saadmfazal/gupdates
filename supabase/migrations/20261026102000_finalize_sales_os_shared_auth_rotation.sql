-- Finalize the Sales OS shared-code retirement only after member login, OAuth,
-- and service-role callers have been deployed and validated. The replacement
-- recovery secret is generated inside Postgres, encrypted by Vault at rest,
-- and never returned to a browser, migration log, or source file.

do $sales_os_team_access_rotation$
declare
  v_secret text;
  v_secret_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sales_os_team_access_rotation',0)
  );

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
      'Server-generated Sales OS recovery secret; never expose to browser clients.',
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_secret,
      'sales_os_team_access_token',
      'Server-generated Sales OS recovery secret; never expose to browser clients.',
      null
    );
  end if;

  insert into public.sales_os_config(key,value,updated_at)
  values (
    'team_access_sha256',
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_secret,'UTF8'),'sha256'),
      'hex'
    ),
    pg_catalog.now()
  )
  on conflict (key) do update
  set value=excluded.value,
      updated_at=excluded.updated_at;
end;
$sales_os_team_access_rotation$;
