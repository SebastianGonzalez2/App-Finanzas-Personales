begin;

-- MEJORA 02 · Pagos recurrentes mensuales automáticos (pg_cron).
-- Cada pago recurrente genera como máximo un gasto mensual en app.expenses
-- (is_recurring = true), garantizado por app.recurring_payment_occurrences y su
-- restricción única (owner_id, recurring_payment_id, billing_month).

-- 1) Marca discreta en app.expenses (no modificable por el cliente).
alter table app.expenses
  add column is_recurring boolean not null default false;

create or replace function private.expense_json(expense_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'amount', e.amount::text, 'currency', e.currency, 'spent_on', to_char(e.spent_on::timestamp, 'YYYY-MM-DD'),
    'category_id', c.id, 'category_name', c.name, 'subcategory_id', s.id, 'subcategory_name', s.name,
    'description', e.description, 'is_recurring', e.is_recurring, 'version', e.version,
    'created_at', to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updated_at', to_char(e.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
  from app.expenses e
  join app.categories c on c.owner_id = e.owner_id and c.id = e.category_id
  left join app.subcategories s on s.owner_id = e.owner_id and s.category_id = e.category_id and s.id = e.subcategory_id
  where e.owner_id = auth.uid() and e.id = expense_id;
$$;

create or replace function api.list_expenses(
  filters jsonb default '{}'::jsonb,
  q text default null,
  sort text default 'spent_on',
  direction text default 'desc',
  "limit" integer default 30,
  cursor text default null
) returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  owner uuid;
  f_from date;
  f_to date;
  f_currency text;
  f_category uuid;
  f_child uuid;
  f_unclassified boolean := false;
  needle text;
  pattern text;
  scope text;
  token_data jsonb;
  after_date date;
  after_amount numeric;
  after_id uuid;
  page app.expenses[];
  final_row app.expenses;
  more boolean;
  next_token text;
  items jsonb;
  actual_parent uuid;
begin
  perform private.require_access();
  owner := auth.uid();

  if filters is null then filters := '{}'::jsonb; end if;
  if jsonb_typeof(filters) <> 'object'
      or filters - array['from','to','currency','category_id','subcategory_id','unclassified_child'] <> '{}'::jsonb then
    raise sqlstate 'PT422' using message = 'INVALID_FILTERS';
  end if;
  f_from := private.filter_date(filters->'from', 'from');
  f_to := private.filter_date(filters->'to', 'to');
  if f_from > f_to then raise sqlstate 'PT422' using message = 'INVALID_DATE_RANGE'; end if;
  if filters ? 'currency' and jsonb_typeof(filters->'currency') <> 'null' then
    if jsonb_typeof(filters->'currency') <> 'string' or filters->>'currency' not in ('UYU','USD','EUR') then
      raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = 'currency';
    end if;
    f_currency := filters->>'currency';
  end if;
  f_category := private.filter_uuid(filters->'category_id', 'category_id');
  f_child := private.filter_uuid(filters->'subcategory_id', 'subcategory_id');
  if filters ? 'unclassified_child' and jsonb_typeof(filters->'unclassified_child') <> 'null' then
    if jsonb_typeof(filters->'unclassified_child') <> 'boolean' then
      raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = 'unclassified_child';
    end if;
    f_unclassified := (filters->>'unclassified_child')::boolean;
  end if;
  if (f_child is not null or f_unclassified) and f_category is null
      or f_child is not null and f_unclassified then
    raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = 'subcategory_id';
  end if;

  needle := nullif(btrim(q, private.whitespace_chars()), '');
  if char_length(needle) > 100 then raise sqlstate 'PT422' using message = 'INVALID_QUERY'; end if;
  pattern := '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  if sort is null or sort not in ('spent_on','amount') or direction is null or direction not in ('asc','desc') then
    raise sqlstate 'PT422' using message = 'INVALID_SORT';
  end if;
  if $5 is null or $5 not between 1 and 100 then raise sqlstate 'PT422' using message = 'INVALID_LIMIT'; end if;

  if f_category is not null then
    perform 1 from app.categories c where c.owner_id = owner and c.id = f_category;
    if not found then raise sqlstate 'PT404' using message = 'CATEGORY_NOT_FOUND'; end if;
  end if;
  if f_child is not null then
    select s.category_id into actual_parent from app.subcategories s where s.owner_id = owner and s.id = f_child;
    if not found then raise sqlstate 'PT404' using message = 'SUBCATEGORY_NOT_FOUND'; end if;
    if actual_parent <> f_category then raise sqlstate 'PT422' using message = 'INVALID_SUBCATEGORY'; end if;
  end if;

  scope := encode(sha256(convert_to(jsonb_build_array(
    owner, to_char(f_from::timestamp, 'YYYY-MM-DD'), to_char(f_to::timestamp, 'YYYY-MM-DD'),
    f_currency, f_category, f_child, f_unclassified, needle, sort, direction
  )::text, 'UTF8')), 'hex');

  token_data := private.decode_cursor(cursor);
  if token_data is not null then
    if token_data - array['v','s','d','k','i','h'] <> '{}'::jsonb
        or token_data->'v' is distinct from '1'::jsonb
        or token_data->>'s' is distinct from sort or token_data->>'d' is distinct from direction
        or token_data->>'h' is distinct from scope
        or jsonb_typeof(token_data->'k') is distinct from 'string'
        or jsonb_typeof(token_data->'i') is distinct from 'string' then
      raise sqlstate 'PT422' using message = 'INVALID_CURSOR';
    end if;
    begin
      after_id := (token_data->>'i')::uuid;
      if sort = 'spent_on' then
        if token_data->>'k' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise sqlstate 'PT422'; end if;
        after_date := (token_data->>'k')::date;
      else
        if token_data->>'k' !~ '^[0-9]{1,12}[.][0-9]{2}$' then raise sqlstate 'PT422'; end if;
        after_amount := (token_data->>'k')::numeric;
      end if;
    exception when others then
      raise sqlstate 'PT422' using message = 'INVALID_CURSOR';
    end;
  end if;

  if sort = 'spent_on' and direction = 'desc' then
    page := array(select e from app.expenses e
      where e.owner_id = owner
        and (f_from is null or e.spent_on >= f_from) and (f_to is null or e.spent_on <= f_to)
        and (f_currency is null or e.currency = f_currency)
        and (f_category is null or e.category_id = f_category)
        and (f_child is null or e.subcategory_id = f_child)
        and (not f_unclassified or e.subcategory_id is null)
        and (pattern is null or e.description ilike pattern escape '\')
        and (after_id is null or (e.spent_on, e.id) < (after_date, after_id))
      order by e.spent_on desc, e.id desc limit $5 + 1);
  elsif sort = 'spent_on' then
    page := array(select e from app.expenses e
      where e.owner_id = owner
        and (f_from is null or e.spent_on >= f_from) and (f_to is null or e.spent_on <= f_to)
        and (f_currency is null or e.currency = f_currency)
        and (f_category is null or e.category_id = f_category)
        and (f_child is null or e.subcategory_id = f_child)
        and (not f_unclassified or e.subcategory_id is null)
        and (pattern is null or e.description ilike pattern escape '\')
        and (after_id is null or (e.spent_on, e.id) > (after_date, after_id))
      order by e.spent_on asc, e.id asc limit $5 + 1);
  elsif direction = 'desc' then
    page := array(select e from app.expenses e
      where e.owner_id = owner
        and (f_from is null or e.spent_on >= f_from) and (f_to is null or e.spent_on <= f_to)
        and (f_currency is null or e.currency = f_currency)
        and (f_category is null or e.category_id = f_category)
        and (f_child is null or e.subcategory_id = f_child)
        and (not f_unclassified or e.subcategory_id is null)
        and (pattern is null or e.description ilike pattern escape '\')
        and (after_id is null or (e.amount, e.id) < (after_amount, after_id))
      order by e.amount desc, e.id desc limit $5 + 1);
  else
    page := array(select e from app.expenses e
      where e.owner_id = owner
        and (f_from is null or e.spent_on >= f_from) and (f_to is null or e.spent_on <= f_to)
        and (f_currency is null or e.currency = f_currency)
        and (f_category is null or e.category_id = f_category)
        and (f_child is null or e.subcategory_id = f_child)
        and (not f_unclassified or e.subcategory_id is null)
        and (pattern is null or e.description ilike pattern escape '\')
        and (after_id is null or (e.amount, e.id) > (after_amount, after_id))
      order by e.amount asc, e.id asc limit $5 + 1);
  end if;

  more := cardinality(page) > $5;
  if more then
    page := page[1:$5];
    final_row := page[$5];
    next_token := private.encode_cursor(jsonb_build_object(
      'v', 1, 's', sort, 'd', direction, 'i', final_row.id, 'h', scope,
      'k', case when sort = 'spent_on' then to_char(final_row.spent_on::timestamp, 'YYYY-MM-DD') else final_row.amount::text end));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'amount', e.amount::text, 'currency', e.currency,
      'spent_on', to_char(e.spent_on::timestamp, 'YYYY-MM-DD'),
      'category_id', c.id, 'category_name', c.name, 'subcategory_id', s.id, 'subcategory_name', s.name,
      'description', e.description, 'is_recurring', e.is_recurring, 'version', e.version,
      'created_at', to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'updated_at', to_char(e.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) order by g.i), '[]'::jsonb)
  into items
  from generate_subscripts(page, 1) as g(i)
  cross join lateral (select (page[g.i]).*) as e
  join app.categories c on c.owner_id = owner and c.id = e.category_id
  left join app.subcategories s on s.owner_id = owner and s.category_id = e.category_id and s.id = e.subcategory_id;

  return jsonb_build_object('items', items, 'next_cursor', next_token);
end;
$$;

revoke all on function private.expense_json(uuid) from public, anon, authenticated, service_role;
grant execute on function private.expense_json(uuid) to authenticated;
revoke all on function api.list_expenses(jsonb,text,text,text,integer,text) from public, anon, authenticated, service_role;
grant execute on function api.list_expenses(jsonb,text,text,text,integer,text) to authenticated;

-- 2) Tabla de pagos recurrentes mensuales.
create table app.recurring_payments (
  owner_id uuid not null references auth.users(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  name text collate pg_catalog."unicode" not null check (name = private.normalize_name(name) and char_length(name) between 1 and 120),
  amount numeric(14,2) not null check (amount between 0.01 and 999999999999.99),
  currency text not null check (currency in ('UYU', 'USD', 'EUR')),
  category_id uuid not null,
  subcategory_id uuid,
  billing_day smallint not null check (billing_day between 1 and 31),
  next_billing_month date not null check (extract(day from next_billing_month) = 1),
  next_billing_date date not null,
  active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  version integer not null default 1 check (version > 0),
  check (active = (deleted_at is null)),
  primary key (owner_id, id),
  foreign key (owner_id, category_id) references app.categories(owner_id, id) on delete restrict,
  foreign key (owner_id, category_id, subcategory_id)
    references app.subcategories(owner_id, category_id, id) on delete restrict
);
create index recurring_payments_owner_next_idx on app.recurring_payments (owner_id, next_billing_date, id) where active = true;
create index recurring_payments_due_idx on app.recurring_payments (next_billing_date, owner_id, id) where active = true;
create index recurring_payments_category_idx on app.recurring_payments (owner_id, category_id, subcategory_id);

create function private.stamp_recurring_payment()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.name is distinct from old.name
      or new.amount is distinct from old.amount
      or new.currency is distinct from old.currency
      or new.category_id is distinct from old.category_id
      or new.subcategory_id is distinct from old.subcategory_id
      or new.billing_day is distinct from old.billing_day
      or new.active is distinct from old.active then
    new.version := old.version + 1;
    new.updated_at := statement_timestamp();
  end if;
  return new;
end;
$$;

create trigger recurring_payment_edit before update on app.recurring_payments
  for each row execute function private.stamp_recurring_payment();

alter table app.recurring_payments enable row level security;
revoke all on app.recurring_payments from public, anon, authenticated, service_role;
grant select,
  insert (owner_id, name, amount, currency, category_id, subcategory_id, billing_day, next_billing_month, next_billing_date),
  update (name, amount, currency, category_id, subcategory_id, billing_day, next_billing_month, next_billing_date, active, deleted_at)
  on app.recurring_payments to authenticated;

create policy read_own on app.recurring_payments for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.allowed()));
create policy insert_own on app.recurring_payments for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.allowed()));
create policy update_own on app.recurring_payments for update to authenticated
  using (owner_id = (select auth.uid()) and (select private.allowed()))
  with check (owner_id = (select auth.uid()) and (select private.allowed()));

-- 3) Registro persistente de ocurrencias procesadas / pendientes (unicidad mensual a nivel BD).
create table app.recurring_payment_occurrences (
  owner_id uuid not null references auth.users(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  recurring_payment_id uuid not null,
  billing_month date not null check (extract(day from billing_month) = 1),
  scheduled_for date not null,
  status text not null check (status in ('pending', 'processed', 'blocked')),
  snapshot_name text collate pg_catalog."unicode" not null,
  snapshot_amount numeric(14,2) not null check (snapshot_amount between 0.01 and 999999999999.99),
  snapshot_currency text not null check (snapshot_currency in ('UYU', 'USD', 'EUR')),
  snapshot_category_id uuid not null,
  snapshot_subcategory_id uuid,
  expense_id uuid,
  error_code text,
  created_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  primary key (owner_id, id),
  unique (owner_id, recurring_payment_id, billing_month),
  foreign key (owner_id, recurring_payment_id) references app.recurring_payments(owner_id, id) on delete cascade
);
create index recurring_occurrences_pending_idx
  on app.recurring_payment_occurrences (scheduled_for, owner_id, id) where status = 'pending';

alter table app.recurring_payment_occurrences enable row level security;
revoke all on app.recurring_payment_occurrences from public, anon, authenticated, service_role;
grant select,
  insert (owner_id, recurring_payment_id, billing_month, scheduled_for, status, snapshot_name, snapshot_amount, snapshot_currency, snapshot_category_id, snapshot_subcategory_id)
  on app.recurring_payment_occurrences to authenticated;

create policy read_own on app.recurring_payment_occurrences for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.allowed()));
create policy insert_own on app.recurring_payment_occurrences for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.allowed())
    and status = 'pending'
    and expense_id is null
  );

-- 4) Funciones auxiliares (todas SECURITY INVOKER, search_path vacío).
create function private.effective_billing_date(p_month date, p_billing_day smallint)
returns date language sql immutable parallel safe security invoker set search_path = ''
as $$
  select least(p_month + (p_billing_day - 1), ((p_month + interval '1 month')::date - 1))
$$;

create function private.recurring_fields(
  input_name text, input_amount text, input_currency text,
  parent_id uuid, child_id uuid, input_billing_day integer
) returns app.recurring_payments language plpgsql immutable security invoker set search_path = ''
as $$
declare
  fields app.recurring_payments;
  label text;
begin
  label := private.normalize_name(input_name);
  if label is null or char_length(label) not between 1 and 120 then
    raise sqlstate 'PT422' using message = 'INVALID_RECURRING_NAME';
  end if;
  if input_amount is null or input_amount !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' then
    raise sqlstate 'PT422' using message = 'INVALID_AMOUNT';
  end if;
  fields.amount := input_amount::numeric(14,2);
  if fields.amount <= 0 then
    raise sqlstate 'PT422' using message = 'INVALID_AMOUNT';
  end if;
  if input_currency is null or input_currency not in ('UYU', 'USD', 'EUR') then
    raise sqlstate 'PT422' using message = 'INVALID_CURRENCY';
  end if;
  if parent_id is null then
    raise sqlstate 'PT422' using message = 'INVALID_CATEGORY';
  end if;
  if input_billing_day is null or input_billing_day not between 1 and 31 then
    raise sqlstate 'PT422' using message = 'INVALID_BILLING_DAY';
  end if;
  fields.name := label;
  fields.currency := input_currency;
  fields.category_id := parent_id;
  fields.subcategory_id := child_id;
  fields.billing_day := input_billing_day::smallint;
  return fields;
end;
$$;

create function private.recurring_payment_json(p_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', rp.id,
    'name', rp.name,
    'amount', rp.amount::text,
    'currency', rp.currency,
    'category_id', c.id,
    'category_name', c.name,
    'category_archived', c.archived,
    'subcategory_id', s.id,
    'subcategory_name', s.name,
    'subcategory_archived', coalesce(s.archived, false),
    'billing_day', rp.billing_day,
    'next_billing_date', to_char(rp.next_billing_date::timestamp, 'YYYY-MM-DD'),
    'needs_attention', (c.archived or coalesce(s.archived, false)),
    'last_error_code', case when occ.status = 'blocked' then occ.error_code end,
    'last_processed_for', case when occ.status = 'processed' then to_char(occ.scheduled_for::timestamp, 'YYYY-MM-DD') end,
    'version', rp.version,
    'created_at', to_char(rp.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updated_at', to_char(rp.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
  from app.recurring_payments rp
  join app.categories c on c.owner_id = rp.owner_id and c.id = rp.category_id
  left join app.subcategories s on s.owner_id = rp.owner_id and s.category_id = rp.category_id and s.id = rp.subcategory_id
  left join lateral (
    select o.status, o.error_code, o.scheduled_for
    from app.recurring_payment_occurrences o
    where o.owner_id = rp.owner_id and o.recurring_payment_id = rp.id and o.status in ('processed', 'blocked')
    order by o.billing_month desc
    limit 1
  ) occ on true
  where rp.owner_id = auth.uid() and rp.id = p_id and rp.active = true;
$$;

-- 5) RPCs de usuario en el esquema api.
create function api.list_recurring_payments()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_today date;
  items jsonb;
begin
  perform private.require_access();
  v_today := private.today();
  select coalesce(jsonb_agg(private.recurring_payment_json(rp.id) order by rp.next_billing_date asc, lower(rp.name) asc, rp.id asc), '[]'::jsonb)
  into items
  from app.recurring_payments rp
  where rp.owner_id = auth.uid() and rp.active = true;

  return jsonb_build_object(
    'today', to_char(v_today::timestamp, 'YYYY-MM-DD'),
    'items', items
  );
end;
$$;

create function api.create_recurring_payment(
  name text, amount text, currency text, category_id uuid,
  subcategory_id uuid default null, billing_day integer default null
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_owner uuid;
  v_fields app.recurring_payments;
  v_today date;
  v_cur_month date;
  v_eff date;
  v_next_month date;
  v_next_date date;
  v_id uuid;
begin
  perform private.require_access();
  v_owner := auth.uid();
  v_fields := private.recurring_fields($1, $2, $3, $4, $5, $6);
  perform private.require_classification(v_fields.category_id, v_fields.subcategory_id);

  v_today := private.today();
  v_cur_month := date_trunc('month', v_today)::date;
  v_eff := private.effective_billing_date(v_cur_month, v_fields.billing_day);
  if v_eff < v_today then
    v_next_month := (v_cur_month + interval '1 month')::date;
  else
    v_next_month := v_cur_month;
  end if;
  v_next_date := private.effective_billing_date(v_next_month, v_fields.billing_day);

  insert into app.recurring_payments (
    owner_id, name, amount, currency, category_id, subcategory_id,
    billing_day, next_billing_month, next_billing_date
  ) values (
    v_owner, v_fields.name, v_fields.amount, v_fields.currency, v_fields.category_id, v_fields.subcategory_id,
    v_fields.billing_day, v_next_month, v_next_date
  ) returning id into v_id;

  return private.recurring_payment_json(v_id);
end;
$$;

create function api.update_recurring_payment(
  id uuid, version integer, name text, amount text, currency text,
  category_id uuid, subcategory_id uuid default null, billing_day integer default null
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_owner uuid;
  old_rp app.recurring_payments;
  v_fields app.recurring_payments;
  v_today date;
  v_cur_month date;
  v_month date;
  v_due date;
  v_next_month date;
  v_next_date date;
begin
  perform private.require_access();
  v_owner := auth.uid();
  if $1 is null then raise sqlstate 'PT422' using message = 'INVALID_ID'; end if;
  if $2 is null or $2 < 1 then raise sqlstate 'PT422' using message = 'INVALID_VERSION'; end if;

  select rp.* into old_rp
  from app.recurring_payments rp
  where rp.owner_id = v_owner and rp.id = $1 and rp.active = true
  for update;
  if not found then raise sqlstate 'PT404' using message = 'RECURRING_NOT_FOUND'; end if;
  if old_rp.version <> $2 then raise sqlstate 'PT409' using message = 'STALE_VERSION'; end if;

  v_fields := private.recurring_fields($3, $4, $5, $6, $7, $8);
  perform private.require_classification(v_fields.category_id, v_fields.subcategory_id);

  v_today := private.today();
  v_cur_month := date_trunc('month', v_today)::date;

  -- Regla 7: congelar las ocurrencias ya vencidas con sus condiciones originales antes de aplicar la edición.
  v_month := old_rp.next_billing_month;
  loop
    v_due := private.effective_billing_date(v_month, old_rp.billing_day);
    exit when v_due > v_today;
    insert into app.recurring_payment_occurrences (
      owner_id, recurring_payment_id, billing_month, scheduled_for, status,
      snapshot_name, snapshot_amount, snapshot_currency, snapshot_category_id, snapshot_subcategory_id
    ) values (
      v_owner, old_rp.id, v_month, v_due, 'pending',
      old_rp.name, old_rp.amount, old_rp.currency, old_rp.category_id, old_rp.subcategory_id
    ) on conflict (owner_id, recurring_payment_id, billing_month) do nothing;
    v_month := (v_month + interval '1 month')::date;
  end loop;

  v_next_month := greatest(v_month, v_cur_month);
  if v_next_month = v_cur_month and (
    exists (
      select 1 from app.recurring_payment_occurrences o
      where o.owner_id = v_owner and o.recurring_payment_id = old_rp.id and o.billing_month = v_cur_month
    )
    or private.effective_billing_date(v_cur_month, v_fields.billing_day) < v_today
  ) then
    v_next_month := (v_cur_month + interval '1 month')::date;
  end if;
  v_next_date := private.effective_billing_date(v_next_month, v_fields.billing_day);

  update app.recurring_payments rp set
    name = v_fields.name,
    amount = v_fields.amount,
    currency = v_fields.currency,
    category_id = v_fields.category_id,
    subcategory_id = v_fields.subcategory_id,
    billing_day = v_fields.billing_day,
    next_billing_month = v_next_month,
    next_billing_date = v_next_date
  where rp.owner_id = v_owner and rp.id = old_rp.id and rp.version = $2;
  if not found then raise sqlstate 'PT409' using message = 'STALE_VERSION'; end if;

  return private.recurring_payment_json(old_rp.id);
end;
$$;

create function api.delete_recurring_payment(id uuid, version integer)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_owner uuid;
  old_rp app.recurring_payments;
begin
  perform private.require_access();
  v_owner := auth.uid();
  if $1 is null then raise sqlstate 'PT422' using message = 'INVALID_ID'; end if;
  if $2 is null or $2 < 1 then raise sqlstate 'PT422' using message = 'INVALID_VERSION'; end if;

  select rp.* into old_rp
  from app.recurring_payments rp
  where rp.owner_id = v_owner and rp.id = $1 and rp.active = true
  for update;
  if not found then raise sqlstate 'PT404' using message = 'RECURRING_NOT_FOUND'; end if;
  if old_rp.version <> $2 then raise sqlstate 'PT409' using message = 'STALE_VERSION'; end if;

  update app.recurring_payments rp
  set active = false, deleted_at = statement_timestamp()
  where rp.owner_id = v_owner and rp.id = old_rp.id and rp.version = $2 and rp.active = true;
  if not found then raise sqlstate 'PT409' using message = 'STALE_VERSION'; end if;

  return jsonb_build_object('id', old_rp.id, 'deleted', true);
end;
$$;

-- 6) Proceso automático compartido (invocado exclusivamente por pg_cron / postgres).
create function private.process_recurring_payments(p_as_of date default null)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_today date := coalesce(p_as_of, private.today());
  v_processed integer := 0;
  v_pending_processed integer := 0;
  v_blocked integer := 0;
  v_errors integer := 0;
  o record;
  rp record;
  v_cat_archived boolean;
  v_sub_archived boolean;
  v_sub_parent uuid;
  v_expense_id uuid;
  v_hash text;
  v_month date;
  v_due date;
  v_occ_id uuid;
begin
  -- Paso A: procesar ocurrencias pendientes congeladas (p. ej. previas a una edición o recuperadas).
  for o in
    select occ.*
    from app.recurring_payment_occurrences occ
    join app.recurring_payments pay on pay.owner_id = occ.owner_id and pay.id = occ.recurring_payment_id and pay.active = true
    join private.members m on m.owner_id = occ.owner_id
    where occ.status = 'pending' and occ.scheduled_for <= v_today
    order by occ.scheduled_for asc, occ.id asc
    for update of occ skip locked
  loop
    begin
      select c.archived into v_cat_archived
      from app.categories c
      where c.owner_id = o.owner_id and c.id = o.snapshot_category_id
      for share;

      if not found or v_cat_archived then
        update app.recurring_payment_occurrences
        set status = 'blocked', error_code = 'CATEGORY_ARCHIVED', processed_at = statement_timestamp()
        where owner_id = o.owner_id and id = o.id;
        v_blocked := v_blocked + 1;
        continue;
      end if;

      if o.snapshot_subcategory_id is not null then
        select s.category_id, s.archived into v_sub_parent, v_sub_archived
        from app.subcategories s
        where s.owner_id = o.owner_id and s.id = o.snapshot_subcategory_id
        for share;

        if not found or v_sub_parent <> o.snapshot_category_id or v_sub_archived then
          update app.recurring_payment_occurrences
          set status = 'blocked', error_code = 'SUBCATEGORY_ARCHIVED', processed_at = statement_timestamp()
          where owner_id = o.owner_id and id = o.id;
          v_blocked := v_blocked + 1;
          continue;
        end if;
      end if;

      v_expense_id := pg_catalog.gen_random_uuid();
      v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_array(
        o.snapshot_amount::text, o.snapshot_currency, to_char(o.scheduled_for::timestamp, 'YYYY-MM-DD'),
        o.snapshot_category_id, o.snapshot_subcategory_id, o.snapshot_name
      )::text, 'UTF8')), 'hex');

      insert into app.expense_keys (owner_id, id, fingerprint)
      values (o.owner_id, v_expense_id, v_hash);

      insert into app.expenses (
        owner_id, id, amount, currency, spent_on, category_id, subcategory_id, description, is_recurring
      ) values (
        o.owner_id, v_expense_id, o.snapshot_amount, o.snapshot_currency, o.scheduled_for,
        o.snapshot_category_id, o.snapshot_subcategory_id, o.snapshot_name, true
      );

      update app.recurring_payment_occurrences
      set status = 'processed', expense_id = v_expense_id, error_code = null, processed_at = statement_timestamp()
      where owner_id = o.owner_id and id = o.id;

      v_pending_processed := v_pending_processed + 1;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;

  -- Paso B: procesar pagos recurrentes activos vencidos hasta v_today (incluye recuperación tras caídas).
  for rp in
    select p.*
    from app.recurring_payments p
    join private.members m on m.owner_id = p.owner_id
    where p.active = true and p.next_billing_date <= v_today
    order by p.next_billing_date asc, p.id asc
    for update of p skip locked
  loop
    begin
      v_month := rp.next_billing_month;
      loop
        v_due := private.effective_billing_date(v_month, rp.billing_day);
        exit when v_due > v_today;

        insert into app.recurring_payment_occurrences (
          owner_id, recurring_payment_id, billing_month, scheduled_for, status,
          snapshot_name, snapshot_amount, snapshot_currency, snapshot_category_id, snapshot_subcategory_id
        ) values (
          rp.owner_id, rp.id, v_month, v_due, 'pending',
          rp.name, rp.amount, rp.currency, rp.category_id, rp.subcategory_id
        ) on conflict (owner_id, recurring_payment_id, billing_month) do nothing
        returning id into v_occ_id;

        if v_occ_id is not null then
          select c.archived into v_cat_archived
          from app.categories c
          where c.owner_id = rp.owner_id and c.id = rp.category_id
          for share;

          if not found or v_cat_archived then
            update app.recurring_payment_occurrences
            set status = 'blocked', error_code = 'CATEGORY_ARCHIVED', processed_at = statement_timestamp()
            where owner_id = rp.owner_id and id = v_occ_id;
            v_blocked := v_blocked + 1;
          else
            v_sub_archived := false;
            if rp.subcategory_id is not null then
              select s.category_id, s.archived into v_sub_parent, v_sub_archived
              from app.subcategories s
              where s.owner_id = rp.owner_id and s.id = rp.subcategory_id
              for share;
              if not found or v_sub_parent <> rp.category_id then
                v_sub_archived := true;
              end if;
            end if;

            if v_sub_archived then
              update app.recurring_payment_occurrences
              set status = 'blocked', error_code = 'SUBCATEGORY_ARCHIVED', processed_at = statement_timestamp()
              where owner_id = rp.owner_id and id = v_occ_id;
              v_blocked := v_blocked + 1;
            else
              v_expense_id := pg_catalog.gen_random_uuid();
              v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_array(
                rp.amount::text, rp.currency, to_char(v_due::timestamp, 'YYYY-MM-DD'),
                rp.category_id, rp.subcategory_id, rp.name
              )::text, 'UTF8')), 'hex');

              insert into app.expense_keys (owner_id, id, fingerprint)
              values (rp.owner_id, v_expense_id, v_hash);

              insert into app.expenses (
                owner_id, id, amount, currency, spent_on, category_id, subcategory_id, description, is_recurring
              ) values (
                rp.owner_id, v_expense_id, rp.amount, rp.currency, v_due,
                rp.category_id, rp.subcategory_id, rp.name, true
              );

              update app.recurring_payment_occurrences
              set status = 'processed', expense_id = v_expense_id, error_code = null, processed_at = statement_timestamp()
              where owner_id = rp.owner_id and id = v_occ_id;

              v_processed := v_processed + 1;
            end if;
          end if;
        end if;

        v_month := (v_month + interval '1 month')::date;
      end loop;

      update app.recurring_payments
      set next_billing_month = v_month,
          next_billing_date = private.effective_billing_date(v_month, rp.billing_day)
      where owner_id = rp.owner_id and id = rp.id;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;

  return jsonb_build_object(
    'as_of', to_char(v_today::timestamp, 'YYYY-MM-DD'),
    'processed', v_processed,
    'pending_processed', v_pending_processed,
    'blocked', v_blocked,
    'errors', v_errors
  );
end;
$$;

-- 7) ACLs explícitas.
revoke all on function private.stamp_recurring_payment(), private.process_recurring_payments(date)
  from public, anon, authenticated, service_role;

revoke all on function private.effective_billing_date(date,smallint),
  private.recurring_fields(text,text,text,uuid,uuid,integer),
  private.recurring_payment_json(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.effective_billing_date(date,smallint),
  private.recurring_fields(text,text,text,uuid,uuid,integer),
  private.recurring_payment_json(uuid) to authenticated;

revoke all on function api.list_recurring_payments(),
  api.create_recurring_payment(text,text,text,uuid,uuid,integer),
  api.update_recurring_payment(uuid,integer,text,text,text,uuid,uuid,integer),
  api.delete_recurring_payment(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function api.list_recurring_payments(),
  api.create_recurring_payment(text,text,text,uuid,uuid,integer),
  api.update_recurring_payment(uuid,integer,text,text,text,uuid,uuid,integer),
  api.delete_recurring_payment(uuid,integer) to authenticated;

-- 8) Habilitar pg_cron y programar tarea única compartida cada 15 minutos
-- (en entornos embebidos sin pg_cron disponible, el bloque se omite sin error).
do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    if to_regnamespace('cron') is not null then
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'cifra-process-recurring-payments';

      perform cron.schedule(
        'cifra-process-recurring-payments',
        '*/15 * * * *',
        $job$select private.process_recurring_payments();$job$
      );
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
