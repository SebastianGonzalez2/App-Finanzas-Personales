begin;

-- Use the same whitespace set as the browser's trim() and /\s+/gu.
create function private.whitespace_chars()
returns text language sql immutable parallel safe security invoker set search_path = ''
as $$ select U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF' $$;

create function private.normalize_name(input text)
returns text language sql immutable strict parallel safe security invoker set search_path = ''
as $$ select btrim(regexp_replace(input, '[' || private.whitespace_chars() || ']+', ' ', 'g')) $$;

create table app.categories (
  owner_id uuid not null references auth.users(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  name text collate pg_catalog."unicode" not null check (name = private.normalize_name(name) and char_length(name) between 1 and 80),
  archived boolean not null default false,
  primary key (owner_id, id)
);
create unique index categories_name_key on app.categories (owner_id, lower(name));

create table app.subcategories (
  owner_id uuid not null references auth.users(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  category_id uuid not null,
  name text collate pg_catalog."unicode" not null check (name = private.normalize_name(name) and char_length(name) between 1 and 80),
  archived boolean not null default false,
  primary key (owner_id, id),
  unique (owner_id, category_id, id),
  foreign key (owner_id, category_id) references app.categories(owner_id, id) on delete restrict
);
create unique index subcategories_name_key on app.subcategories (owner_id, category_id, lower(name));

create table app.expense_keys (
  owner_id uuid not null references auth.users(id) on delete restrict,
  id uuid not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  primary key (owner_id, id)
);

create table app.expenses (
  owner_id uuid not null references auth.users(id) on delete restrict,
  id uuid not null,
  amount numeric(14,2) not null check (amount between 0.01 and 999999999999.99),
  currency text not null check (currency in ('UYU', 'USD', 'EUR')),
  spent_on date not null check (spent_on between date '0001-01-01' and date '9999-12-31'),
  category_id uuid not null,
  subcategory_id uuid,
  description text check (description = btrim(description, private.whitespace_chars()) and char_length(description) between 1 and 500),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  version integer not null default 1 check (version > 0),
  primary key (owner_id, id),
  foreign key (owner_id, id) references app.expense_keys(owner_id, id) on delete restrict,
  foreign key (owner_id, category_id) references app.categories(owner_id, id) on delete restrict,
  foreign key (owner_id, category_id, subcategory_id)
    references app.subcategories(owner_id, category_id, id) on delete restrict
);
create index expenses_spent_on_idx on app.expenses (owner_id, spent_on, id);
create index expenses_currency_date_idx on app.expenses (owner_id, currency, spent_on);
create index expenses_category_currency_date_idx on app.expenses (owner_id, category_id, currency, spent_on);
create index expenses_subcategory_idx on app.expenses (owner_id, category_id, subcategory_id)
  where subcategory_id is not null;

-- The operator provisions a preference once per member. Its unique owner_id
-- serializes concurrent inserts. Only a successful INSERT fires the trigger.
create function private.seed_catalog(member_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  perform 1 from app.preferences p where p.owner_id = member_id for update;
  if not found or exists (select 1 from app.categories c where c.owner_id = member_id) then
    return;
  end if;

  with parents as (
    insert into app.categories (owner_id, name)
    select member_id, label from unnest(array['Alimentación', 'Vivienda', 'Servicios', 'Transporte',
      'Auto', 'Salud', 'Educación', 'Ropa', 'Entretenimiento', 'Viajes', 'Seguros',
      'Impuestos', 'Otros gastos']) as seed(label)
    returning id, name
  )
  insert into app.subcategories (owner_id, category_id, name)
  select member_id, p.id, s.child from parents p
  join (values
    ('Alimentación','Supermercado'), ('Alimentación','Restaurantes'), ('Alimentación','Delivery'),
    ('Vivienda','Alquiler'), ('Vivienda','Mantenimiento'),
    ('Transporte','Transporte público'), ('Transporte','Taxi/Uber'),
    ('Ropa','Ropa'), ('Ropa','Calzado')
  ) as s(parent, child) on p.name = s.parent;
end;
$$;

create function private.seed_preference_catalog()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.seed_catalog(new.owner_id);
  return new;
end;
$$;

create trigger preference_catalog after insert on app.preferences
  for each row execute function private.seed_preference_catalog();
-- Includes IMP-01 preferences; takes no action on membership or Auth.
select private.seed_catalog(p.owner_id) from app.preferences p;

create function private.stamp_expense()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger expense_edit before update on app.expenses
  for each row execute function private.stamp_expense();

alter table app.categories enable row level security;
alter table app.subcategories enable row level security;
alter table app.expense_keys enable row level security;
alter table app.expenses enable row level security;

-- The API invoker can read its own rows only and write the columns each RPC needs.
-- No browser role may delete catalog entries or replace/remove an idempotency key.
revoke all on app.categories, app.subcategories, app.expense_keys, app.expenses
  from public, anon, authenticated, service_role;
grant select on app.categories, app.subcategories, app.expense_keys, app.expenses to authenticated;
grant insert (owner_id, name), update (name, archived) on app.categories to authenticated;
grant insert (owner_id, name, category_id), update (name, archived) on app.subcategories to authenticated;
grant insert (owner_id, id, fingerprint) on app.expense_keys to authenticated;
grant insert (owner_id, id, amount, currency, spent_on, category_id, subcategory_id, description),
  update (amount, currency, spent_on, category_id, subcategory_id, description), delete on app.expenses to authenticated;

do $$
declare
  target text;
  own constant text := 'owner_id = (select auth.uid()) and (select private.allowed())';
begin
  foreach target in array array['categories','subcategories','expense_keys','expenses'] loop
    execute format('create policy read_own on app.%I for select to authenticated using (%s)', target, own);
    execute format('create policy insert_own on app.%I for insert to authenticated with check (%s)', target, own);
    if target <> 'expense_keys' then
      execute format('create policy update_own on app.%I for update to authenticated using (%s) with check (%s)', target, own, own);
    end if;
  end loop;
  execute format('create policy delete_own on app.expenses for delete to authenticated using (%s)', own);
end;
$$;

create function private.require_access()
returns void language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not private.allowed() then
    raise sqlstate 'PT403' using message = 'ACCESS_DENIED';
  end if;
end;
$$;

create function api.get_catalog()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
begin
  perform private.require_access();
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'archived', c.archived) order by lower(c.name), c.id)
      from app.categories c where c.owner_id = auth.uid()), '[]'::jsonb),
    'subcategories', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'category_id', s.category_id, 'name', s.name, 'archived', s.archived) order by lower(s.name), s.id)
      from app.subcategories s where s.owner_id = auth.uid()), '[]'::jsonb)
  );
end;
$$;

-- Row locks always follow parent -> child, ordering an archive against new assignments.
create function private.require_classification(parent_id uuid, child_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  inactive boolean;
  actual_parent uuid;
begin
  if parent_id is null then raise sqlstate 'PT422' using message = 'INVALID_CATEGORY'; end if;
  select c.archived into inactive from app.categories c
    where c.owner_id = auth.uid() and c.id = parent_id for share;
  if not found then raise sqlstate 'PT404' using message = 'CATEGORY_NOT_FOUND'; end if;
  if inactive then raise sqlstate 'PT422' using message = 'CATEGORY_ARCHIVED'; end if;
  if child_id is not null then
    select s.category_id, s.archived into actual_parent, inactive from app.subcategories s
      where s.owner_id = auth.uid() and s.id = child_id for share;
    if not found then raise sqlstate 'PT404' using message = 'SUBCATEGORY_NOT_FOUND'; end if;
    if actual_parent <> parent_id then raise sqlstate 'PT422' using message = 'INVALID_SUBCATEGORY'; end if;
    if inactive then raise sqlstate 'PT422' using message = 'SUBCATEGORY_ARCHIVED'; end if;
  end if;
end;
$$;

create function api.create_category(name text, category_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  label text;
  result jsonb;
begin
  perform private.require_access();
  label := private.normalize_name($1);
  if label is null or char_length(label) not between 1 and 80 then
    raise sqlstate 'PT422' using message = 'INVALID_NAME';
  end if;
  if $2 is null then
    insert into app.categories as c (owner_id, name) values (auth.uid(), label)
      returning jsonb_build_object('id', c.id, 'name', c.name, 'archived', c.archived) into result;
  else
    perform private.require_classification($2, null);
    insert into app.subcategories as s (owner_id, category_id, name) values (auth.uid(), $2, label)
      returning jsonb_build_object('id', s.id, 'category_id', s.category_id, 'name', s.name, 'archived', s.archived) into result;
  end if;
  return result;
exception when unique_violation then raise sqlstate 'PT409' using message = 'DUPLICATE_NAME';
end;
$$;

create function api.update_category(kind text, id uuid, patch jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  label text;
  inactive boolean;
  result jsonb;
begin
  perform private.require_access();
  if kind is null or kind not in ('category','subcategory') then
    raise sqlstate 'PT422' using message = 'INVALID_KIND';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise sqlstate 'PT422' using message = 'INVALID_PATCH';
  end if;
  if patch = '{}'::jsonb or patch - array['name','archived'] <> '{}'::jsonb
      or (patch ? 'name' and jsonb_typeof(patch->'name') <> 'string')
      or (patch ? 'archived' and jsonb_typeof(patch->'archived') <> 'boolean') then
    raise sqlstate 'PT422' using message = 'INVALID_PATCH';
  end if;
  label := private.normalize_name(patch->>'name');
  if label is not null and char_length(label) not between 1 and 80 then
    raise sqlstate 'PT422' using message = 'INVALID_NAME';
  end if;
  inactive := (patch->>'archived')::boolean;
  if kind = 'category' then
    update app.categories c set name = coalesce(label,c.name), archived = coalesce(inactive,c.archived)
      where c.owner_id = auth.uid() and c.id = $2
      returning jsonb_build_object('id', c.id, 'name', c.name, 'archived', c.archived) into result;
    if not found then raise sqlstate 'PT404' using message = 'CATEGORY_NOT_FOUND'; end if;
  else
    update app.subcategories s set name = coalesce(label,s.name), archived = coalesce(inactive,s.archived)
      where s.owner_id = auth.uid() and s.id = $2
      returning jsonb_build_object('id', s.id, 'category_id', s.category_id, 'name', s.name, 'archived', s.archived) into result;
    if not found then raise sqlstate 'PT404' using message = 'SUBCATEGORY_NOT_FOUND'; end if;
  end if;
  return result;
exception when unique_violation then raise sqlstate 'PT409' using message = 'DUPLICATE_NAME';
end;
$$;


-- Parse the text wire format before PostgreSQL can round a fractional amount.
create function private.expense_fields(
  input_amount text, input_currency text, input_date text, parent_id uuid, child_id uuid, input_description text
) returns app.expenses language plpgsql immutable security invoker set search_path = ''
as $$
declare
  fields app.expenses;
begin
  if input_amount is null or input_amount !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' then
    raise sqlstate 'PT422' using message = 'INVALID_AMOUNT';
  end if;
  fields.amount := input_amount::numeric(14,2);
  if fields.amount <= 0 then raise sqlstate 'PT422' using message = 'INVALID_AMOUNT'; end if;
  if input_currency is null or input_currency not in ('UYU','USD','EUR') then
    raise sqlstate 'PT422' using message = 'INVALID_CURRENCY';
  end if;
  if input_date is null or input_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or left(input_date, 4) = '0000' then
    raise sqlstate 'PT422' using message = 'INVALID_DATE';
  end if;
  begin
    fields.spent_on := input_date::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise sqlstate 'PT422' using message = 'INVALID_DATE';
  end;
  if parent_id is null then raise sqlstate 'PT422' using message = 'INVALID_CATEGORY'; end if;
  fields.currency := input_currency;
  fields.category_id := parent_id;
  fields.subcategory_id := child_id;
  fields.description := nullif(btrim(input_description, private.whitespace_chars()), '');
  if char_length(fields.description) > 500 then raise sqlstate 'PT422' using message = 'INVALID_DESCRIPTION'; end if;
  return fields;
end;
$$;

create function private.expense_json(expense_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'amount', e.amount::text, 'currency', e.currency, 'spent_on', to_char(e.spent_on::timestamp, 'YYYY-MM-DD'),
    'category_id', c.id, 'category_name', c.name, 'subcategory_id', s.id, 'subcategory_name', s.name,
    'description', e.description, 'version', e.version,
    'created_at', to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updated_at', to_char(e.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
  from app.expenses e
  join app.categories c on c.owner_id = e.owner_id and c.id = e.category_id
  left join app.subcategories s on s.owner_id = e.owner_id and s.category_id = e.category_id and s.id = e.subcategory_id
  where e.owner_id = auth.uid() and e.id = expense_id;
$$;

create function api.get_expense(id uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_access();
  result := private.expense_json($1);
  if result is null then raise sqlstate 'PT404' using message = 'EXPENSE_NOT_FOUND'; end if;
  return result;
end;
$$;

create function api.create_expense(
  id uuid, amount text, currency text, spent_on text, category_id uuid,
  subcategory_id uuid default null, description text default null
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  owner uuid;
  fields app.expenses;
  submission_hash text;
  stored_hash text;
  result jsonb;
  replayed boolean;
begin
  perform private.require_access();
  owner := auth.uid();
  if $1 is null then raise sqlstate 'PT422' using message = 'INVALID_ID'; end if;
  fields := private.expense_fields($2,$3,$4,$5,$6,$7);
  submission_hash := encode(sha256(convert_to(jsonb_build_array(
    fields.amount::text, fields.currency, to_char(fields.spent_on::timestamp,'YYYY-MM-DD'),
    fields.category_id, fields.subcategory_id, fields.description
  )::text, 'UTF8')), 'hex');

  -- Conflicting INSERT waits for its competitor. Subsequent statements in
  -- this VOLATILE RPC read the winning transaction under READ COMMITTED.
  insert into app.expense_keys (owner_id, id, fingerprint) values (owner, $1, submission_hash)
    on conflict on constraint expense_keys_pkey do nothing;
  replayed := not found;
  if replayed then
    select k.fingerprint into strict stored_hash from app.expense_keys k where k.owner_id = owner and k.id = $1;
    if stored_hash <> submission_hash then raise sqlstate 'PT409' using message = 'ID_REUSED'; end if;
  else
    perform private.require_classification(fields.category_id, fields.subcategory_id);
    insert into app.expenses (owner_id, id, amount, currency, spent_on, category_id, subcategory_id, description)
      values (owner, $1, fields.amount, fields.currency, fields.spent_on,
        fields.category_id, fields.subcategory_id, fields.description);
  end if;

  result := private.expense_json($1);
  if result is null then
    perform private.require_access();
    raise sqlstate 'PT409' using message = 'EXPENSE_REMOVED';
  end if;
  return jsonb_build_object('expense', result, 'replayed', replayed);
end;
$$;

-- Lock before comparing the version. The lock also prevents an edit from
-- racing a delete and distinguishes a missing resource from a stale version.
create function private.lock_expense(expense_id uuid, expected_version integer)
returns app.expenses language plpgsql security invoker set search_path = ''
as $$
declare
  previous app.expenses;
begin
  if expected_version is null or expected_version < 1 then
    raise sqlstate 'PT422' using message = 'INVALID_VERSION';
  end if;
  select e.* into previous from app.expenses e
    where e.owner_id = auth.uid() and e.id = expense_id for update;
  if not found then raise sqlstate 'PT404' using message = 'EXPENSE_NOT_FOUND'; end if;
  if previous.version <> expected_version then raise sqlstate 'PT409' using message = 'STALE_VERSION'; end if;
  return previous;
end;
$$;

create function api.update_expense(
  id uuid, version integer, amount text, currency text, spent_on text,
  category_id uuid, subcategory_id uuid, description text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  previous app.expenses;
  fields app.expenses;
  result jsonb;
begin
  perform private.require_access();
  previous := private.lock_expense($1,$2);
  fields := private.expense_fields($3,$4,$5,$6,$7,$8);
  -- Keeping the historical pair, or removing just its child, is always valid.
  if previous.category_id <> fields.category_id or
      (fields.subcategory_id is not null and previous.subcategory_id is distinct from fields.subcategory_id) then
    perform private.require_classification(fields.category_id, fields.subcategory_id);
  end if;
  update app.expenses e set amount = fields.amount, currency = fields.currency, spent_on = fields.spent_on,
    category_id = fields.category_id, subcategory_id = fields.subcategory_id, description = fields.description
    where e.owner_id = auth.uid() and e.id = $1 and e.version = $2;
  if not found then raise sqlstate 'PT403' using message = 'ACCESS_DENIED'; end if;
  result := private.expense_json($1);
  if result is null then raise sqlstate 'PT403' using message = 'ACCESS_DENIED'; end if;
  return result;
end;
$$;

create function api.delete_expense(id uuid, version integer)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.require_access();
  perform private.lock_expense($1,$2);
  delete from app.expenses e where e.owner_id = auth.uid() and e.id = $1 and e.version = $2;
  if not found then raise sqlstate 'PT403' using message = 'ACCESS_DENIED'; end if;
  return jsonb_build_object('id', $1, 'deleted', true);
end;
$$;

-- Explicit ACLs also cover projects with custom per-schema default grants.
revoke all on function private.seed_catalog(uuid), private.seed_preference_catalog(), private.stamp_expense()
  from public, anon, authenticated, service_role;

revoke all on function private.whitespace_chars(), private.normalize_name(text), private.require_access(),
  private.require_classification(uuid,uuid), private.expense_fields(text,text,text,uuid,uuid,text),
  private.expense_json(uuid), private.lock_expense(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.whitespace_chars(), private.normalize_name(text), private.require_access(),
  private.require_classification(uuid,uuid), private.expense_fields(text,text,text,uuid,uuid,text),
  private.expense_json(uuid), private.lock_expense(uuid,integer) to authenticated;

revoke all on function api.get_catalog(), api.create_category(text,uuid), api.update_category(text,uuid,jsonb),
  api.get_expense(uuid), api.create_expense(uuid,text,text,text,uuid,uuid,text),
  api.update_expense(uuid,integer,text,text,text,uuid,uuid,text), api.delete_expense(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function api.get_catalog(), api.create_category(text,uuid), api.update_category(text,uuid,jsonb),
  api.get_expense(uuid), api.create_expense(uuid,text,text,text,uuid,uuid,text),
  api.update_expense(uuid,integer,text,text,text,uuid,uuid,text), api.delete_expense(uuid,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
