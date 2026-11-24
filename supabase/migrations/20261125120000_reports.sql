begin;

-- IMP-04 · Estadísticas. Read-only aggregate RPCs over the caller's expenses and
-- the private list of favourite panels. Every RPC checks the seat and the exact
-- session first, reads app tables through RLS plus an explicit owner predicate
-- and aggregates a single currency with SUM(numeric) / COUNT(*). Amounts and
-- percentages travel as decimal text; percentages are rounded once, here.

-- Civil date of the business time zone (ARCH-01 §5, §9). One definition for
-- preferences, partial periods and the annual window.
create function private.today()
returns date language sql stable parallel safe security invoker set search_path = ''
as $$ select (statement_timestamp() at time zone 'America/Montevideo')::date $$;

-- Canonical order of the six panels (ARCH-01 §10). NULL for any other key.
create function private.panel_order(panel text)
returns integer language sql immutable parallel safe security invoker set search_path = ''
as $$ select array_position(array['metrics','monthly','categories','comparison','annual','summary'], panel) $$;

create table app.favorites (
  owner_id uuid not null references auth.users(id) on delete restrict,
  panel text not null check (private.panel_order(panel) is not null),
  primary key (owner_id, panel)
);
alter table app.favorites enable row level security;
revoke all on app.favorites from public, anon, authenticated, service_role;
grant select, delete, insert (owner_id, panel) on app.favorites to authenticated;
create policy read_own on app.favorites for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.allowed()));
create policy insert_own on app.favorites for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.allowed()));
create policy delete_own on app.favorites for delete to authenticated
  using (owner_id = (select auth.uid()) and (select private.allowed()));

-- Same contract as IMP-01, now with the caller's favourites in canonical order.
create or replace function api.get_preferences()
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  preferred_currency text;
begin
  perform private.require_access();

  select p.currency into strict preferred_currency
  from app.preferences as p
  where p.owner_id = auth.uid();

  return jsonb_build_object(
    'currency', preferred_currency,
    'favorites', coalesce((
      select jsonb_agg(f.panel order by private.panel_order(f.panel))
      from app.favorites as f where f.owner_id = auth.uid()
    ), '[]'::jsonb),
    'today', to_char(private.today()::timestamp, 'YYYY-MM-DD')
  );
end;
$$;

create function api.set_favorite(panel text, enabled boolean)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.require_access();
  if $1 is null or private.panel_order($1) is null then
    raise sqlstate 'PT422' using message = 'INVALID_PANEL';
  end if;
  if $2 is null then raise sqlstate 'PT422' using message = 'INVALID_FAVORITE'; end if;
  -- Repeating either operation is idempotent.
  if $2 then
    insert into app.favorites (owner_id, panel) values (auth.uid(), $1) on conflict do nothing;
  else
    delete from app.favorites as f where f.owner_id = auth.uid() and f.panel = $1;
  end if;
  return jsonb_build_object('panel', $1, 'enabled', $2);
end;
$$;

-- Filters of get_stats: the IMP-03 Filters type with a mandatory range and
-- currency. Archived classifications are valid; foreign or missing ids answer
-- 404 exactly like ids that never existed.
create function private.stats_filters(
  filters jsonb,
  out f_from date, out f_to date, out f_currency text,
  out f_category uuid, out f_child uuid, out f_unclassified boolean
) language plpgsql stable security invoker set search_path = ''
as $$
declare
  actual_parent uuid;
begin
  if filters is null or jsonb_typeof(filters) <> 'object'
      or filters - array['from','to','currency','category_id','subcategory_id','unclassified_child'] <> '{}'::jsonb then
    raise sqlstate 'PT422' using message = 'INVALID_FILTERS';
  end if;
  f_from := private.filter_date(filters->'from', 'from');
  f_to := private.filter_date(filters->'to', 'to');
  if f_from is null then raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = 'from'; end if;
  if f_to is null then raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = 'to'; end if;
  if f_from > f_to then raise sqlstate 'PT422' using message = 'INVALID_DATE_RANGE'; end if;
  if jsonb_typeof(filters->'currency') is distinct from 'string' or filters->>'currency' not in ('UYU','USD','EUR') then
    raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = 'currency';
  end if;
  f_currency := filters->>'currency';
  f_category := private.filter_uuid(filters->'category_id', 'category_id');
  f_child := private.filter_uuid(filters->'subcategory_id', 'subcategory_id');
  f_unclassified := false;
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
  if f_category is not null then
    perform 1 from app.categories c where c.owner_id = auth.uid() and c.id = f_category;
    if not found then raise sqlstate 'PT404' using message = 'CATEGORY_NOT_FOUND'; end if;
  end if;
  if f_child is not null then
    select s.category_id into actual_parent from app.subcategories s where s.owner_id = auth.uid() and s.id = f_child;
    if not found then raise sqlstate 'PT404' using message = 'SUBCATEGORY_NOT_FOUND'; end if;
    if actual_parent <> f_category then raise sqlstate 'PT422' using message = 'INVALID_SUBCATEGORY'; end if;
  end if;
end;
$$;

create function private.stats_reference(reference jsonb, out r_from date, out r_to date)
language plpgsql immutable security invoker set search_path = ''
as $$
begin
  if reference is null or jsonb_typeof(reference) = 'null' then return; end if;
  if jsonb_typeof(reference) <> 'object' or reference - array['from','to'] <> '{}'::jsonb then
    raise sqlstate 'PT422' using message = 'INVALID_REFERENCE';
  end if;
  begin
    r_from := private.filter_date(reference->'from', 'reference.from');
    r_to := private.filter_date(reference->'to', 'reference.to');
  exception when sqlstate 'PT422' then
    raise sqlstate 'PT422' using message = 'INVALID_REFERENCE';
  end;
  if r_from is null or r_to is null or r_from > r_to then
    raise sqlstate 'PT422' using message = 'INVALID_REFERENCE';
  end if;
end;
$$;

-- ARCH-01 §9: a percentage needs equivalent intervals, i.e. the same number of
-- days or the same number of complete civil months, with the same progress.
-- Only two concluded intervals qualify; an interval that reaches today is open.
create function private.equivalent_periods(a_from date, a_to date, b_from date, b_to date, today date)
returns boolean language sql immutable parallel safe security invoker set search_path = ''
as $$
  select a_to < today and b_to < today and (
    a_to - a_from = b_to - b_from
    or (
      extract(day from a_from) = 1 and extract(day from b_from) = 1
      and extract(day from a_to + 1) = 1 and extract(day from b_to + 1) = 1
      and (extract(year from a_to) * 12 + extract(month from a_to)) - (extract(year from a_from) * 12 + extract(month from a_from))
        = (extract(year from b_to) * 12 + extract(month from b_to)) - (extract(year from b_from) * 12 + extract(month from b_from))
    )
  )
$$;

-- Comparison {current, reference, delta, percent}. Absence of rows on either
-- side leaves both differences NULL; a non-equivalent pair keeps the absolute
-- difference but has no percentage.
create function private.comparison_json(
  cur_count bigint, cur_total numeric, ref_count bigint, ref_total numeric, has_reference boolean, comparable boolean
) returns jsonb language sql immutable parallel safe security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'current', jsonb_build_object('count', coalesce(cur_count, 0), 'total', cur_total::text),
    'reference', case when has_reference then jsonb_build_object('count', coalesce(ref_count, 0), 'total', ref_total::text) end,
    'delta', case when has_reference and cur_count > 0 and ref_count > 0 then (cur_total - ref_total)::text end,
    'percent', case when has_reference and comparable and cur_count > 0 and ref_count > 0 and ref_total <> 0
      then round(100 * (cur_total - ref_total) / ref_total, 2)::text end
  )
$$;

create function api.get_stats(filters jsonb, reference jsonb default null, month_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  owner uuid;
  f_from date;
  f_to date;
  f_currency text;
  f_category uuid;
  f_child uuid;
  f_unclassified boolean;
  r_from date;
  r_to date;
  has_reference boolean;
  comparable boolean;
  first_index integer;
  month_count integer;
  block_first integer;
  block_last integer;
  result jsonb;
begin
  perform private.require_access();
  owner := auth.uid();

  select * into f_from, f_to, f_currency, f_category, f_child, f_unclassified from private.stats_filters(filters);
  select * into r_from, r_to from private.stats_reference(reference);
  has_reference := r_from is not null;
  comparable := case when has_reference then private.equivalent_periods(f_from, f_to, r_from, r_to, private.today()) end;

  -- Months are numbered year * 12 + month - 1. A block lists at most 60 months.
  first_index := extract(year from f_from)::integer * 12 + extract(month from f_from)::integer - 1;
  month_count := extract(year from f_to)::integer * 12 + extract(month from f_to)::integer - first_index;
  if $3 is null or $3 < 0 or $3 >= month_count then
    raise sqlstate 'PT422' using message = 'INVALID_OFFSET';
  end if;
  block_first := first_index + $3;
  block_last := first_index + least($3 + 59, month_count - 1);

  -- One snapshot (STABLE) for every panel. The predicate is applied to the
  -- expense before any name is joined, so each row is counted exactly once.
  with cur as materialized (
    select e.category_id, e.subcategory_id, e.amount, e.spent_on
    from app.expenses e
    where e.owner_id = owner and e.currency = f_currency and e.spent_on between f_from and f_to
      and (f_category is null or e.category_id = f_category)
      and (f_child is null or e.subcategory_id = f_child)
      and (not f_unclassified or e.subcategory_id is null)
  ), ref as materialized (
    select e.category_id, e.amount
    from app.expenses e
    where has_reference and e.owner_id = owner and e.currency = f_currency and e.spent_on between r_from and r_to
      and (f_category is null or e.category_id = f_category)
      and (f_child is null or e.subcategory_id = f_child)
      and (not f_unclassified or e.subcategory_id is null)
  ), cur_total as (
    select count(*) as n, sum(c.amount) as total from cur c
  ), ref_total as (
    select count(*) as n, sum(r.amount) as total from ref r
  ), cur_by_category as (
    select c.category_id, count(*) as n, sum(c.amount) as total from cur c group by c.category_id
  ), ref_by_category as (
    select r.category_id, count(*) as n, sum(r.amount) as total from ref r group by r.category_id
  ), by_child as (
    select c.subcategory_id, count(*) as n, sum(c.amount) as total from cur c
    where f_category is not null group by c.subcategory_id
  ), block as (
    select g.idx, make_date(g.idx / 12, g.idx % 12 + 1, 1) as m_start,
      make_date((g.idx + 1) / 12, (g.idx + 1) % 12 + 1, 1) - 1 as m_end
    from generate_series(block_first, block_last) as g(idx)
  ), by_month as (
    select extract(year from c.spent_on)::integer * 12 + extract(month from c.spent_on)::integer - 1 as idx,
      count(*) as n, sum(c.amount) as total
    from cur c group by 1
  )
  select jsonb_build_object(
    'filters', jsonb_build_object(
      'from', to_char(f_from::timestamp, 'YYYY-MM-DD'), 'to', to_char(f_to::timestamp, 'YYYY-MM-DD'),
      'currency', f_currency, 'category_id', f_category, 'subcategory_id', f_child,
      'unclassified_child', f_unclassified),
    'reference', case when has_reference then jsonb_build_object(
      'from', to_char(r_from::timestamp, 'YYYY-MM-DD'), 'to', to_char(r_to::timestamp, 'YYYY-MM-DD')) end,
    'comparable', comparable,
    'indicator', (select private.comparison_json(t.n, t.total, rt.n, rt.total, has_reference, comparable)
      from cur_total t cross join ref_total rt),
    'months', (select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(b.m_start::timestamp, 'YYYY-MM'),
        'from', to_char(greatest(b.m_start, f_from)::timestamp, 'YYYY-MM-DD'),
        'to', to_char(least(b.m_end, f_to)::timestamp, 'YYYY-MM-DD'),
        'count', coalesce(m.n, 0), 'total', m.total::text) order by b.idx), '[]'::jsonb)
      from block b left join by_month m on m.idx = b.idx),
    'month_next_offset', case when $3 + 60 < month_count then $3 + 60 end,
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.category_id, 'name', c.name, 'count', g.n, 'total', g.total::text,
        'share', round(100 * g.total / t.total, 2)::text) order by g.total desc, lower(c.name), c.id), '[]'::jsonb)
      from cur_by_category g
      join app.categories c on c.owner_id = owner and c.id = g.category_id
      cross join cur_total t),
    'children', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.subcategory_id, 'name', s.name, 'count', g.n, 'total', g.total::text,
        'share', round(100 * g.total / t.total, 2)::text)
        order by g.total desc, lower(s.name) nulls last, s.id nulls last), '[]'::jsonb)
      from by_child g
      left join app.subcategories s on s.owner_id = owner and s.category_id = f_category and s.id = g.subcategory_id
      cross join cur_total t),
    'category_comparisons', (select coalesce(jsonb_agg(
        jsonb_build_object('id', c.id, 'name', c.name)
          || private.comparison_json(u.cur_n, u.cur_total, u.ref_n, u.ref_total, true, comparable)
        order by lower(c.name), c.id), '[]'::jsonb)
      from (
        select coalesce(a.category_id, r.category_id) as category_id,
          a.n as cur_n, a.total as cur_total, r.n as ref_n, r.total as ref_total
        from cur_by_category a full join ref_by_category r on r.category_id = a.category_id
      ) u
      join app.categories c on c.owner_id = owner and c.id = u.category_id
      where has_reference)
  ) into result;
  return result;
end;
$$;

-- Annual series of one currency (ARCH-01 §10). Five years ending in end_year,
-- plus the year just before the block to compare the first visible point.
create function api.get_annual(
  currency text, end_year integer default null, category_id uuid default null, subcategory_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  owner uuid;
  this_year integer;
  last_year integer;
  first_year integer;
  actual_parent uuid;
  parent_name text;
  child_name text;
  points jsonb;
begin
  perform private.require_access();
  owner := auth.uid();
  if $1 is null or $1 not in ('UYU','USD','EUR') then raise sqlstate 'PT422' using message = 'INVALID_CURRENCY'; end if;
  this_year := extract(year from private.today())::integer;
  last_year := coalesce($2, this_year);
  if last_year < 1 or last_year > this_year then raise sqlstate 'PT422' using message = 'INVALID_YEAR'; end if;
  first_year := greatest(1, last_year - 4);
  if $4 is not null and $3 is null then
    raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = 'subcategory_id';
  end if;
  if $3 is not null then
    select c.name into parent_name from app.categories c where c.owner_id = owner and c.id = $3;
    if not found then raise sqlstate 'PT404' using message = 'CATEGORY_NOT_FOUND'; end if;
  end if;
  if $4 is not null then
    select s.category_id, s.name into actual_parent, child_name from app.subcategories s where s.owner_id = owner and s.id = $4;
    if not found then raise sqlstate 'PT404' using message = 'SUBCATEGORY_NOT_FOUND'; end if;
    if actual_parent <> $3 then raise sqlstate 'PT422' using message = 'INVALID_SUBCATEGORY'; end if;
  end if;

  -- Years are joined to a generated calendar: a year without rows keeps its
  -- place with count 0 and total NULL. Deltas only join two consecutive closed
  -- years that both have rows; the current (partial) year never gets one.
  with totals as (
    select extract(year from e.spent_on)::integer as y, count(*) as n, sum(e.amount) as total
    from app.expenses e
    where e.owner_id = owner and e.currency = $1
      and e.spent_on between make_date(greatest(1, first_year - 1), 1, 1) and make_date(last_year, 12, 31)
      and ($3 is null or e.category_id = $3)
      and ($4 is null or e.subcategory_id = $4)
    group by 1
  )
  select jsonb_agg(jsonb_build_object(
      'year', g.y, 'count', coalesce(t.n, 0), 'total', t.total::text, 'partial', g.y = this_year,
      'delta', case when g.y < this_year and t.n > 0 and p.n > 0 then (t.total - p.total)::text end,
      'percent', case when g.y < this_year and t.n > 0 and p.n > 0
        then round(100 * (t.total - p.total) / p.total, 2)::text end
    ) order by g.y)
  into points
  from generate_series(first_year, last_year) as g(y)
  left join totals t on t.y = g.y
  left join totals p on p.y = g.y - 1;

  return jsonb_build_object(
    'currency', $1, 'category_id', $3, 'subcategory_id', $4,
    'label', case when $4 is not null then parent_name || ' · ' || child_name else parent_name end,
    'start_year', first_year, 'end_year', last_year,
    'previous_end_year', case when first_year > 1 then first_year - 1 end,
    'next_end_year', case when last_year < this_year then least(last_year + 5, this_year) end,
    'points', points
  );
end;
$$;

-- Explicit ACLs, also for projects whose exposed schemas grant EXECUTE by default.
revoke all on function private.today(), private.panel_order(text), private.stats_filters(jsonb),
  private.stats_reference(jsonb), private.equivalent_periods(date,date,date,date,date),
  private.comparison_json(bigint,numeric,bigint,numeric,boolean,boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.today(), private.panel_order(text), private.stats_filters(jsonb),
  private.stats_reference(jsonb), private.equivalent_periods(date,date,date,date,date),
  private.comparison_json(bigint,numeric,bigint,numeric,boolean,boolean) to authenticated;

revoke all on function api.get_preferences(), api.set_favorite(text,boolean), api.get_stats(jsonb,jsonb,integer),
  api.get_annual(text,integer,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.get_preferences(), api.set_favorite(text,boolean), api.get_stats(jsonb,jsonb,integer),
  api.get_annual(text,integer,uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
