\set ON_ERROR_STOP on

select test_support.assert_true(
  (select relrowsecurity from pg_catalog.pg_class where oid='public.sales_os_auth_requests'::regclass),
  'member login request evidence has RLS enabled'
);

select test_support.assert_true(
  not has_table_privilege('anon','public.sales_os_auth_requests','select')
  and not has_table_privilege('authenticated','public.sales_os_auth_requests','select')
  and has_table_privilege('service_role','public.sales_os_auth_requests','select,insert,delete'),
  'member login request evidence is service-only'
);

select test_support.assert_true(
  not has_function_privilege('anon','public.sales_os_allow_member_login(text,text,text)','execute')
  and not has_function_privilege('authenticated','public.sales_os_allow_member_login(text,text,text)','execute')
  and has_function_privilege('service_role','public.sales_os_allow_member_login(text,text,text)','execute'),
  'member login rate gate is service-only'
);

begin;
set local role service_role;
select public.sales_os_allow_member_login('operator@example.test',repeat('a',64),repeat('b',64)) as member_attempt_1 \gset
select public.sales_os_allow_member_login('operator@example.test',repeat('a',64),repeat('b',64)) as member_attempt_2 \gset
select public.sales_os_allow_member_login('operator@example.test',repeat('a',64),repeat('b',64)) as member_attempt_3 \gset
select public.sales_os_allow_member_login('operator@example.test',repeat('a',64),repeat('b',64)) as member_attempt_4 \gset
select public.sales_os_allow_member_login('not-a-member@example.test',repeat('c',64),repeat('d',64)) as nonmember_attempt \gset
rollback;

select test_support.assert_true(
  :'member_attempt_1'::boolean and :'member_attempt_2'::boolean and :'member_attempt_3'::boolean
  and not :'member_attempt_4'::boolean,
  'active member is allowed three requests per fifteen minutes and the fourth is denied'
);

select test_support.assert_true(
  not :'nonmember_attempt'::boolean,
  'nonmember login request is denied'
);

select test_support.assert_true(
  (select count(*)=1 from vault.secrets where name='sales_os_team_access_token'),
  'exactly one managed Sales OS recovery secret exists'
);

select test_support.assert_true(
  (
    select c.value=pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v.decrypted_secret,'UTF8'),'sha256'),
      'hex'
    )
    from public.sales_os_config c
    cross join vault.decrypted_secrets v
    where c.key='team_access_sha256' and v.name='sales_os_team_access_token'
  ),
  'Vault recovery secret digest matches Sales OS verifier configuration'
);

select test_support.assert_true(
  (select c.value<>b.config_hash
   from public.sales_os_config c cross join test_support.auth_rotation_before b
   where c.key='team_access_sha256'),
  'rotation replaced the exposed credential digest'
);

select test_support.assert_true(
  not public.sales_os_auth_ok('fixture-token'),
  'previous shared access code is revoked'
);

begin;
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select public.sales_os_auth_ok(null) as anon_without_code \gset
rollback;
select test_support.assert_true(
  not :'anon_without_code'::boolean,
  'anonymous request without a recovery code is rejected'
);

begin;
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","email":"operator@example.test"}';
select public.sales_os_auth_ok(null) as member_jwt_ok \gset
rollback;
select test_support.assert_true(
  :'member_jwt_ok'::boolean,
  'active member JWT remains authorized without a shared code'
);

begin;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select public.sales_os_auth_ok(null) as service_role_ok \gset
rollback;
select test_support.assert_true(
  :'service_role_ok'::boolean,
  'service-role backend JWT is authorized without a shared code'
);

select test_support.assert_true(
  (select p.proacl=b.auth_acl
   from pg_catalog.pg_proc p cross join test_support.auth_rotation_before b
   where p.oid='public.sales_os_auth_ok(text)'::regprocedure),
  'shared verifier grants are unchanged'
);

select test_support.assert_true(
  (select count(*)=39 from test_support.auth_rotation_dependent_acl),
  'synthetic dependency map contains all 39 Sales OS callers'
);

select test_support.assert_true(
  not exists (
    select 1
    from test_support.auth_rotation_dependent_acl b
    join pg_catalog.pg_proc p on p.oid=b.identity::regprocedure
    where p.proacl is distinct from b.proacl
  ),
  'all 39 dependent RPC grants are unchanged'
);

begin;
create or replace function public.sales_os_auth_ok(p_token text)
returns boolean language sql stable security definer set search_path to ''
as $function$ select false $function$;
rollback;

select test_support.assert_true(
  not public.sales_os_auth_ok('fixture-token'),
  'rollback recovery never restores the exposed shared code'
);

begin;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select public.sales_os_auth_ok(null) as service_role_recovery_ok \gset
rollback;
select test_support.assert_true(
  :'service_role_recovery_ok'::boolean,
  'service-role recovery remains available after a failed staged change'
);

select 'AUTH_ROTATION_ASSERTIONS_PASSED' as result;
