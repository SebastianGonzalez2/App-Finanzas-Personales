begin;

-- Keep alive y monitoreo (docs/keep-alive.md). Única función de `api` ejecutable sin sesión:
-- no lee ni escribe tablas, solo confirma que la Data API puede ejecutar SQL en PostgreSQL.
-- Es repetible: se puede volver a ejecutar sin efectos adicionales.
create or replace function api.health_check()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object('status', 'ok', 'checked_at', pg_catalog.now());
$$;

revoke all on function api.health_check() from public, anon, authenticated, service_role;
grant usage on schema api to anon;
grant execute on function api.health_check() to anon;

-- USAGE permite a `anon` resolver nombres dentro de `api`. Si algún otro objeto del esquema le
-- hubiera quedado concedido (por ejemplo desde el panel), se cancela toda la migración.
do $$
declare
  exposed text;
begin
  select string_agg(name, ', ') into exposed
  from (
    select p.oid::regprocedure::text as name
    from pg_catalog.pg_proc as p
    where p.pronamespace = 'api'::regnamespace
      and p.oid <> 'api.health_check()'::regprocedure
      and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
    union all
    select c.oid::regclass::text
    from pg_catalog.pg_class as c
    where c.relnamespace = 'api'::regnamespace
      and c.relkind in ('r', 'v', 'm', 'f', 'p')
      and (pg_catalog.has_table_privilege('anon', c.oid, 'select, insert, update, delete')
        or pg_catalog.has_any_column_privilege('anon', c.oid, 'select, insert, update'))
  ) as objects;

  if exposed is not null then
    raise exception 'health_check cancelado: anon tendría acceso a %', exposed;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
