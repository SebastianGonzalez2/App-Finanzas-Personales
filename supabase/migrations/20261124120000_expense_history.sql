begin;

-- IMP-03 · Historial. A single read-only RPC filters, orders and pages the
-- caller's expenses in PostgreSQL. Every query reads app.expenses through RLS
-- and an explicit owner predicate; the cursor only positions inside that set.

-- Supports ordering by amount in both directions. Date ordering already uses
-- expenses_spent_on_idx (owner_id, spent_on, id), scanned forwards or backwards.
create index expenses_amount_idx on app.expenses (owner_id, amount, id);

create function private.filter_date(input jsonb, field text)
returns date language plpgsql immutable security invoker set search_path = ''
as $$
declare
  raw text;
begin
  if input is null or jsonb_typeof(input) = 'null' then return null; end if;
  raw := input #>> '{}';
  if jsonb_typeof(input) <> 'string' or raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(raw, 4) = '0000' then
    raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = field;
  end if;
  return raw::date;
exception when invalid_datetime_format or datetime_field_overflow then
  raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = field;
end;
$$;

create function private.filter_uuid(input jsonb, field text)
returns uuid language plpgsql immutable security invoker set search_path = ''
as $$
begin
  if input is null or jsonb_typeof(input) = 'null' then return null; end if;
  if jsonb_typeof(input) <> 'string' then
    raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = field;
  end if;
  return (input #>> '{}')::uuid;
exception when invalid_text_representation then
  raise sqlstate 'PT422' using message = 'INVALID_FILTERS', detail = field;
end;
$$;

-- Opaque page token: base64url(JSON) with the exact last key, its id, the
-- order and a digest of owner, filters and search. The token never grants
-- access: the page query still restricts rows to auth.uid().
create function private.decode_cursor(token text)
returns jsonb language plpgsql immutable security invoker set search_path = ''
as $$
declare
  body text;
  result jsonb;
begin
  if token is null then return null; end if;
  if char_length(token) > 512 or token !~ '^[A-Za-z0-9_-]+$' then
    raise sqlstate 'PT422' using message = 'INVALID_CURSOR';
  end if;
  body := translate(token, '-_', '+/');
  body := body || repeat('=', (4 - char_length(body) % 4) % 4);
  result := convert_from(decode(body, 'base64'), 'UTF8')::jsonb;
  if jsonb_typeof(result) <> 'object' then raise sqlstate 'PT422' using message = 'INVALID_CURSOR'; end if;
  return result;
exception
  when sqlstate 'PT422' then raise;
  when others then raise sqlstate 'PT422' using message = 'INVALID_CURSOR';
end;
$$;

create function private.encode_cursor(payload jsonb)
returns text language sql immutable strict parallel safe security invoker set search_path = ''
as $$
  select rtrim(translate(replace(encode(convert_to(payload::text, 'UTF8'), 'base64'), E'\n', ''), '+/', '-_'), '=')
$$;

create function api.list_expenses(
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

  -- Arguments. Any unknown filter key, wrong JSON type or value is rejected.
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
  -- Literal, case-insensitive match: escape the escape character first.
  pattern := '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  if sort is null or sort not in ('spent_on','amount') or direction is null or direction not in ('asc','desc') then
    raise sqlstate 'PT422' using message = 'INVALID_SORT';
  end if;
  if $5 is null or $5 not between 1 and 100 then raise sqlstate 'PT422' using message = 'INVALID_LIMIT'; end if;

  -- Archived classifications remain valid filters. Foreign or missing ids
  -- answer 404 exactly like an id that never existed.
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

  -- Four fixed statements, one per order. Each reads limit + 1 rows to know
  -- whether another page exists; (key, id) keeps ties deterministic.
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

  -- Current names come from one join for the whole page, archived included.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'amount', e.amount::text, 'currency', e.currency,
      'spent_on', to_char(e.spent_on::timestamp, 'YYYY-MM-DD'),
      'category_id', c.id, 'category_name', c.name, 'subcategory_id', s.id, 'subcategory_name', s.name,
      'description', e.description, 'version', e.version,
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

revoke all on function private.filter_date(jsonb,text), private.filter_uuid(jsonb,text),
  private.decode_cursor(text), private.encode_cursor(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.filter_date(jsonb,text), private.filter_uuid(jsonb,text),
  private.decode_cursor(text), private.encode_cursor(jsonb) to authenticated;

revoke all on function api.list_expenses(jsonb,text,text,text,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function api.list_expenses(jsonb,text,text,text,integer,text) to authenticated;

notify pgrst, 'reload schema';
commit;
