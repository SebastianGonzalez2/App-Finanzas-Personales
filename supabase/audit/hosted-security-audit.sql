-- IMP-06 · Auditoría de seguridad del proyecto alojado. SOLO LECTURA: no modifica datos ni
-- permisos. Ejecutar en el SQL Editor como postgres. No devuelve correos, UUID ni tokens.
-- Excepción esperada desde la migración health_check (docs/keep-alive.md): "health_check" aparece
-- en api_anon_or_public_execute y api_without_authenticated, y schema_usage marca api anon=true.
select jsonb_build_object(
  'migrations', (select jsonb_agg(version || ' ' || name order by version) from supabase_migrations.schema_migrations),
  'tables', (select jsonb_agg(n.nspname || '.' || c.relname || ' rls=' || c.relrowsecurity
      || ' pol=' || (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname)
      || ' anon=' || has_table_privilege('anon', c.oid, 'select,insert,update,delete')
      || ' auth=' || concat_ws('', case when has_table_privilege('authenticated', c.oid, 'select') then 'S' end,
        case when has_any_column_privilege('authenticated', c.oid, 'insert') then 'I' end,
        case when has_any_column_privilege('authenticated', c.oid, 'update') then 'U' end,
        case when has_table_privilege('authenticated', c.oid, 'delete') then 'D' end)
      order by n.nspname, c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('app', 'private', 'api', 'public') and c.relkind in ('r', 'v', 'm', 'p')),
  'app_policies_without_seat_check', (select coalesce(jsonb_agg(tablename || '.' || policyname), '[]') from pg_policies
    where schemaname = 'app' and coalesce(qual, '') || coalesce(with_check, '') not like '%allowed()%'),
  'app_policies_without_owner_check', (select coalesce(jsonb_agg(tablename || '.' || policyname), '[]') from pg_policies
    where schemaname = 'app' and coalesce(qual, '') || coalesce(with_check, '') not like '%auth.uid()%'),
  'policy_roles', (select jsonb_agg(distinct roles::text) from pg_policies where schemaname in ('app', 'private')),
  'api_functions', (select count(*) from pg_proc p where p.pronamespace = 'api'::regnamespace),
  'api_security_definer', (select coalesce(jsonb_agg(proname), '[]') from pg_proc where pronamespace = 'api'::regnamespace and prosecdef),
  'api_anon_or_public_execute', (select coalesce(jsonb_agg(proname), '[]') from pg_proc p where pronamespace = 'api'::regnamespace
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  'api_without_authenticated', (select coalesce(jsonb_agg(proname), '[]') from pg_proc p where pronamespace = 'api'::regnamespace
    and not has_function_privilege('authenticated', p.oid, 'execute')),
  'functions_without_empty_search_path', (select coalesce(jsonb_agg(n.nspname || '.' || p.proname), '[]') from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('api', 'private')
    and not coalesce(p.proconfig @> array['search_path=""'], false)),
  'private_security_definer', (select jsonb_agg(p.proname || ' owner=' || pg_get_userbyid(p.proowner) || ' vol=' || p.provolatile::text
      || ' args=' || p.pronargs || ' anon=' || has_function_privilege('anon', p.oid, 'execute')
      || ' service=' || has_function_privilege('service_role', p.oid, 'execute'))
    from pg_proc p where p.pronamespace = 'private'::regnamespace and p.prosecdef),
  'private_anon_execute', (select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace
    and has_function_privilege('anon', p.oid, 'execute')),
  'schema_usage', (select jsonb_agg(s || ' anon=' || has_schema_privilege('anon', s, 'usage') || ' auth=' || has_schema_privilege('authenticated', s, 'usage'))
    from unnest(array['api', 'app', 'private', 'public', 'graphql_public']) as s where to_regnamespace(s) is not null),
  'client_reads_auth_sessions', has_table_privilege('authenticated', 'auth.sessions', 'select'),
  'client_reads_members', has_table_privilege('authenticated', 'private.members', 'select'),
  'authenticator_config', (select rolconfig from pg_roles where rolname = 'authenticator'),
  'auth_users', (select count(*) from auth.users),
  'identities_by_provider', (select jsonb_object_agg(provider, n) from (select provider, count(*) as n from auth.identities group by 1) x),
  'members', (select count(*) from private.members),
  'members_with_google_identity', (select count(*) from private.members m where exists (
    select 1 from auth.identities i where i.user_id = m.owner_id and i.provider = 'google')),
  'bootstrap_emails', (select count(*) from private.bootstrap_emails),
  'auth_sessions', (select count(*) from auth.sessions),
  'app_rows', jsonb_build_object('expenses', (select count(*) from app.expenses), 'budgets', (select count(*) from app.budgets),
    'favorites', (select count(*) from app.favorites), 'categories', (select count(*) from app.categories),
    'expense_keys', (select count(*) from app.expense_keys))
) as audit;
