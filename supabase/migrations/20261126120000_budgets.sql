begin;

-- IMP-05 · Presupuestos mensuales (RF-024 a RF-026). A budget is a monthly
-- spending counter for one parent category and one currency, never reserved
-- money. Only the limit is stored; consumption, remaining amount and percentage
-- are derived on every read from the expenses of the current civil month
-- (private.today(), America/Montevideo), so editing, moving or deleting an
-- expense is reflected without any extra write (ARCH-01 §5, §8, §9).

create table app.budgets (
  owner_id uuid not null references auth.users(id) on delete restrict,
  category_id uuid not null,
  currency text not null check (currency in ('UYU', 'USD', 'EUR')),
  monthly_limit numeric(14,2) not null check (monthly_limit between 0.01 and 999999999999.99),
  -- One limit per category and currency. Subcategories cannot hold a budget:
  -- the foreign key only accepts parent categories.
  primary key (owner_id, category_id, currency),
  foreign key (owner_id, category_id) references app.categories(owner_id, id) on delete restrict
);

alter table app.budgets enable row level security;
revoke all on app.budgets from public, anon, authenticated, service_role;
grant select, delete, insert (owner_id, category_id, currency, monthly_limit), update (monthly_limit)
  on app.budgets to authenticated;
create policy read_own on app.budgets for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.allowed()));
create policy insert_own on app.budgets for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.allowed()));
create policy update_own on app.budgets for update to authenticated
  using (owner_id = (select auth.uid()) and (select private.allowed()))
  with check (owner_id = (select auth.uid()) and (select private.allowed()));
create policy delete_own on app.budgets for delete to authenticated
  using (owner_id = (select auth.uid()) and (select private.allowed()));

-- Parse the text wire format before PostgreSQL can round a fractional limit:
-- up to twelve integer digits and two decimals, strictly positive.
create function private.budget_limit(input text)
returns numeric language plpgsql immutable security invoker set search_path = ''
as $$
declare
  result numeric(14,2);
begin
  if input is null or input !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' then
    raise sqlstate 'PT422' using message = 'INVALID_MONTHLY_LIMIT';
  end if;
  result := input::numeric(14,2);
  if result <= 0 then raise sqlstate 'PT422' using message = 'INVALID_MONTHLY_LIMIT'; end if;
  return result;
end;
$$;

create function private.budget_currency(input text)
returns text language plpgsql immutable security invoker set search_path = ''
as $$
begin
  if input is null or input not in ('UYU','USD','EUR') then
    raise sqlstate 'PT422' using message = 'INVALID_CURRENCY';
  end if;
  return input;
end;
$$;

-- Budget items of the caller in one currency for the current civil month,
-- optionally restricted to one category. Expenses are pre-aggregated by parent
-- category before the LEFT JOIN, so a child expense is counted exactly once
-- and a budget without expenses consumes 0.00 (never NULL). Same predicate as
-- get_stats: owner, one currency, spent_on inside the month, parent category.
-- Sorted by the percentage shown (rounded once), then name and id.
create function private.budget_items(p_currency text, p_category uuid default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  with first_day as (
    select t.d - (extract(day from t.d)::integer - 1) as m_start from (select private.today() as d) t
  ), bounds as (
    select f.m_start, (f.m_start + interval '1 month')::date - 1 as m_end from first_day f
  ), spent as materialized (
    select e.category_id, sum(e.amount) as total
    from app.expenses e cross join bounds b
    where e.owner_id = auth.uid() and e.currency = p_currency
      and e.spent_on between b.m_start and b.m_end
      and (p_category is null or e.category_id = p_category)
    group by e.category_id
  ), items as (
    select g.category_id, c.name, g.currency, g.monthly_limit,
      coalesce(s.total, 0.00) as used,
      round(100 * coalesce(s.total, 0.00) / g.monthly_limit, 2) as pct
    from app.budgets g
    join app.categories c on c.owner_id = g.owner_id and c.id = g.category_id
    left join spent s on s.category_id = g.category_id
    where g.owner_id = auth.uid() and g.currency = p_currency
      and (p_category is null or g.category_id = p_category)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'category_id', i.category_id, 'category_name', i.name, 'currency', i.currency,
      'monthly_limit', i.monthly_limit::text, 'spent', i.used::text,
      'remaining', (i.monthly_limit - i.used)::text, 'percent', i.pct::text)
    order by i.pct desc, lower(i.name), i.category_id), '[]'::jsonb)
  from items i;
$$;

create function api.get_budgets(currency text)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  chosen text;
begin
  perform private.require_access();
  chosen := private.budget_currency($1);
  return jsonb_build_object(
    'month', to_char(private.today()::timestamp, 'YYYY-MM'),
    'currency', chosen,
    'items', private.budget_items(chosen)
  );
end;
$$;

-- New limits require an active parent category (ARCH-01 §6). The category row
-- is locked FOR SHARE, ordering the insert against a concurrent archive.
create function api.create_budget(category_id uuid, currency text, monthly_limit text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  chosen text;
  amount numeric(14,2);
begin
  perform private.require_access();
  chosen := private.budget_currency($2);
  amount := private.budget_limit($3);
  perform private.require_classification($1, null);
  insert into app.budgets (owner_id, category_id, currency, monthly_limit)
    values (auth.uid(), $1, chosen, amount);
  return private.budget_items(chosen, $1) -> 0;
exception when unique_violation then raise sqlstate 'PT409' using message = 'DUPLICATE_BUDGET';
end;
$$;

-- Changing a limit never touches expenses. A budget under an archived category
-- remains editable and removable.
create function api.update_budget(category_id uuid, currency text, monthly_limit text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  chosen text;
  amount numeric(14,2);
begin
  perform private.require_access();
  chosen := private.budget_currency($2);
  amount := private.budget_limit($3);
  if $1 is null then raise sqlstate 'PT422' using message = 'INVALID_CATEGORY'; end if;
  update app.budgets g set monthly_limit = amount
    where g.owner_id = auth.uid() and g.category_id = $1 and g.currency = chosen;
  if not found then raise sqlstate 'PT404' using message = 'BUDGET_NOT_FOUND'; end if;
  return private.budget_items(chosen, $1) -> 0;
end;
$$;

create function api.delete_budget(category_id uuid, currency text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  chosen text;
begin
  perform private.require_access();
  chosen := private.budget_currency($2);
  if $1 is null then raise sqlstate 'PT422' using message = 'INVALID_CATEGORY'; end if;
  delete from app.budgets g where g.owner_id = auth.uid() and g.category_id = $1 and g.currency = chosen;
  if not found then raise sqlstate 'PT404' using message = 'BUDGET_NOT_FOUND'; end if;
  return jsonb_build_object('deleted', true);
end;
$$;

-- Explicit ACLs, also for projects whose exposed schemas grant EXECUTE by default.
revoke all on function private.budget_limit(text), private.budget_currency(text), private.budget_items(text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.budget_limit(text), private.budget_currency(text), private.budget_items(text,uuid)
  to authenticated;

revoke all on function api.get_budgets(text), api.create_budget(uuid,text,text), api.update_budget(uuid,text,text),
  api.delete_budget(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function api.get_budgets(text), api.create_budget(uuid,text,text), api.update_budget(uuid,text,text),
  api.delete_budget(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
