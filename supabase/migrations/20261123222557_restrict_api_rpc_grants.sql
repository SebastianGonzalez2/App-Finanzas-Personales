-- Adding an exposed schema in hosted Supabase can grant function access to all API roles.
revoke execute on function api.get_preferences(), api.set_currency(text)
  from public, anon, service_role;
