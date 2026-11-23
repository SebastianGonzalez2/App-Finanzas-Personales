begin;

-- Run as postgres, which owns the narrowly scoped helper and can read auth.sessions.
create schema api;
create schema app;
create schema private;

revoke all on schema api, app, private from public, anon, authenticated, service_role;
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role;

create table private.bootstrap_emails (
  email text primary key check (email <> '' and email = lower(btrim(email)))
);

create table private.members (
  slot smallint primary key check (slot in (1, 2)),
  owner_id uuid not null unique references auth.users (id) on delete restrict
);

create table app.preferences (
  owner_id uuid primary key references auth.users (id) on delete restrict,
  currency text not null default 'UYU' check (currency in ('UYU', 'USD', 'EUR'))
);

alter table private.bootstrap_emails enable row level security;
alter table private.members enable row level security;
alter table app.preferences enable row level security;

revoke all on all tables in schema private, app from public, anon, authenticated, service_role;

create function private.before_user_created(event jsonb)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select case
    when event #>> '{user,app_metadata,provider}' = 'google'
     and exists (
       select 1 from private.bootstrap_emails as admission
       where admission.email = lower(btrim(event #>> '{user,email}'))
     )
     and (select count(*) from private.bootstrap_emails) between 1 and 2
    then '{}'::jsonb
    else jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'SIGNUP_NOT_ALLOWED'
    ))
  end;
$$;

revoke execute on function private.before_user_created(jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;
grant select on private.bootstrap_emails to supabase_auth_admin;
create policy bootstrap_read_for_auth on private.bootstrap_emails
  for select to supabase_auth_admin using (true);

create function private.allowed()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from private.members as member
    join auth.sessions as session on session.user_id = member.owner_id
    where member.owner_id = auth.uid()
      and session.id::text = (auth.jwt() ->> 'session_id')
  );
$$;

alter function private.allowed() owner to postgres;
revoke execute on function private.allowed() from public, anon, authenticated, service_role;
grant usage on schema api, app, private to authenticated;
grant execute on function private.allowed() to authenticated;

grant select (owner_id, currency), update (currency) on app.preferences to authenticated;
create policy preferences_read_own on app.preferences for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.allowed()));
create policy preferences_update_own on app.preferences for update to authenticated
  using (owner_id = (select auth.uid()) and (select private.allowed()))
  with check (owner_id = (select auth.uid()) and (select private.allowed()));

create function api.get_preferences()
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  preferred_currency text;
begin
  if not private.allowed() then
    raise sqlstate 'PT403' using message = 'ACCESS_DENIED';
  end if;

  select p.currency into strict preferred_currency
  from app.preferences as p
  where p.owner_id = auth.uid();

  return jsonb_build_object(
    'currency', preferred_currency,
    'favorites', '[]'::jsonb,
    'today', to_char(statement_timestamp() at time zone 'America/Montevideo', 'YYYY-MM-DD')
  );
end;
$$;

create function api.set_currency(currency text)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  if not private.allowed() then
    raise sqlstate 'PT403' using message = 'ACCESS_DENIED';
  end if;

  if $1 is null or $1 not in ('UYU', 'USD', 'EUR') then
    raise sqlstate 'PT422' using message = 'INVALID_CURRENCY';
  end if;

  update app.preferences as p set currency = $1 where p.owner_id = auth.uid();
  if not found then
    raise sqlstate 'PT500' using message = 'PREFERENCES_UNAVAILABLE';
  end if;
  return jsonb_build_object('currency', $1);
end;
$$;

revoke execute on function api.get_preferences(), api.set_currency(text)
  from public, anon, authenticated, service_role;
grant execute on function api.get_preferences(), api.set_currency(text) to authenticated;

-- Supabase projects may have pg_graphql preinstalled.
do $$
begin
  if to_regnamespace('graphql_public') is not null then
    revoke usage on schema graphql_public from public, anon, authenticated;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
