\set ON_ERROR_STOP on

select test_support.assert_true(
  (select relrowsecurity from pg_catalog.pg_class where oid='public.sales_os_auth_requests'::regclass),
  'member login request evidence has RLS enabled before rotation'
);

select test_support.assert_true(
  not has_table_privilege('anon','public.sales_os_auth_requests','select')
  and not has_table_privilege('authenticated','public.sales_os_auth_requests','select')
  and has_table_privilege('service_role','public.sales_os_auth_requests','select,insert,delete'),
  'member login request evidence is service-only before rotation'
);

select test_support.assert_true(
  not has_function_privilege('anon','public.sales_os_allow_member_login(text,text,text)','execute')
  and not has_function_privilege('authenticated','public.sales_os_allow_member_login(text,text,text)','execute')
  and has_function_privilege('service_role','public.sales_os_allow_member_login(text,text,text)','execute'),
  'member login gate is service-only before rotation'
);

select test_support.assert_true(
  has_table_privilege('service_role','public.sales_os_members','select'),
  'service-role login gate can read the existing active-member allowlist'
);

select test_support.assert_true(
  public.sales_os_auth_ok('fixture-token'),
  'preparation keeps the existing shared credential valid until the final cutover'
);

begin;
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","email":"operator@example.test"}';
select public.sales_os_auth_ok(null) as member_jwt_ok \gset
rollback;
select test_support.assert_true(
  :'member_jwt_ok'::boolean,
  'active member JWT is ready before the shared credential is retired'
);

begin;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select public.sales_os_auth_ok(null) as service_role_ok \gset
rollback;
select test_support.assert_true(
  :'service_role_ok'::boolean,
  'service-role callers are ready before the shared credential is retired'
);

select test_support.assert_true(
  (select count(*)=0 from vault.secrets where name='sales_os_team_access_token'),
  'preparation does not rotate or create the recovery credential early'
);

select test_support.assert_true(
  (select p.proacl=b.auth_acl
   from pg_catalog.pg_proc p cross join test_support.auth_rotation_before b
   where p.oid='public.sales_os_auth_ok(text)'::regprocedure),
  'shared verifier grants are unchanged during preparation'
);

select test_support.assert_true(
  not exists (
    select 1
    from test_support.auth_rotation_dependent_acl b
    join pg_catalog.pg_proc p on p.oid=b.identity::regprocedure
    where p.proacl is distinct from b.proacl
  ),
  'all dependent RPC grants remain unchanged during preparation'
);

select 'AUTH_PREPARE_ASSERTIONS_PASSED' as result;
