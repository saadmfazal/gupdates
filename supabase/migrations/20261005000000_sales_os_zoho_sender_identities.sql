update public.sales_os_zoho_connections
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'sender_identities', jsonb_build_array(
    jsonb_build_object('email', 'yazeed@morpheuspd.io', 'display_name', 'Yazeed'),
    jsonb_build_object('email', 'robert@morpheuspd.io', 'display_name', 'Robert Gibbons')
  ),
  'default_sender_email', 'yazeed@morpheuspd.io'
),
updated_at = now()
where lower(member_email) = 'yazeedmorsath@gmail.com';

create or replace function public.sales_os_zoho_status(p_token text)
returns jsonb
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
      'member_email', c.member_email,
      'zoho_email', c.zoho_email,
      'account_id', c.account_id,
      'accounts_domain', c.accounts_domain,
      'mail_api_domain', c.mail_api_domain,
      'scopes', c.scopes,
      'active', c.active,
      'last_sync_at', c.last_sync_at,
      'last_sync_status', c.last_sync_status,
      'last_sync_detail', c.last_sync_detail,
      'connected_at', c.connected_at,
      'updated_at', c.updated_at,
      'sender_identities', coalesce(c.metadata->'sender_identities', '[]'::jsonb),
      'default_sender_email', coalesce(c.metadata->>'default_sender_email', c.zoho_email)
    ) order by c.member_email)
    from public.sales_os_zoho_connections c
  ), '[]'::jsonb);
end;
$function$;