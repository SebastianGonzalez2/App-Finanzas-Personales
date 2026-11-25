import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useToast } from '../../app/toastContext.js';
import { Icon } from '../../components/Icon.jsx';
import { SpringSelect } from '../../components/SpringSelect.jsx';
import { useCatalog, useExpenseList, useFinance } from '../../lib/finance.js';
import { DeleteExpenseDialog } from './DeleteExpenseDialog.jsx';
import { ExpenseDetail } from './ExpenseDetail.jsx';
import { ExpenseTable } from './ExpenseTable.jsx';
import { HistoryFilters } from './HistoryFilters.jsx';
import { emptyFilters, isFiltered, listArgs, listTitle, readBack, readQuery, RETURN_PARAM, sorts, writeQuery } from './query.js';

function Skeleton() {
  return (
    <div className="history-skeleton" role="status">
      <span className="sr-only">Cargando gastos…</span>
      {Array.from({ length: 5 }, (_, index) => <div key={index} aria-hidden="true"><i /><b /><b /></div>)}
    </div>
  );
}

function Empty({ filtered, onClear }) {
  if (filtered) return (
    <div className="history-empty" role="status">
      <h3>Sin resultados</h3>
      <p>Ningún gasto coincide con la búsqueda o los filtros elegidos.</p>
      <button type="button" className="btn ghost" onClick={onClear}>Limpiar filtros</button>
    </div>
  );
  return (
    <div className="history-empty" role="status">
      <h3>Todavía no registraste gastos</h3>
      <p>Cuando guardes tu primer gasto vas a poder buscarlo, filtrarlo y editarlo desde acá.</p>
      <Link className="btn primary" to="/gastos/nuevo" state={{ from: '/historial' }}><Icon name="plus" />Registrar el primer gasto</Link>
    </div>
  );
}

function HistoryList({ api, today }) {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const search = params.toString();
  const query = useMemo(() => readQuery(new URLSearchParams(search)), [search]);
  const args = useMemo(() => listArgs(query), [query]);
  const list = useExpenseList(api, args);
  const catalog = useCatalog(api);
  const [menu, setMenu] = useState(null);
  const [removing, setRemoving] = useState(null);
  const filtered = isFiltered(query);

  const back = readBack(new URLSearchParams(search));
  const update = useCallback((patch) => {
    setParams((current) => writeQuery({ ...readQuery(current), ...patch }, { [RETURN_PARAM]: readBack(current) }), { replace: true });
  }, [setParams]);
  const clear = useCallback(() => update({ ...emptyFilters, q: '' }), [update]);
  const sortBy = useCallback((sort, direction) => update({ sort, direction }), [update]);
  const deleteRow = useCallback((expense) => setRemoving(expense), []);

  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const order = sorts.find((option) => option.sort === query.sort && option.direction === query.direction);
  // A placeholder belongs to the previous query: it is shown dimmed, never as this query's answer.
  const stale = list.isPlaceholderData;
  const firstError = list.isError && !list.isFetchNextPageError && !list.isRefetchError;

  let body;
  if (firstError) {
    const invalidLink = list.error.status === 404 || list.error.status === 422;
    body = <div className="history-empty" role="alert">
      <h3>{invalidLink ? 'No pudimos aplicar esta consulta' : 'No pudimos cargar el historial'}</h3>
      <p>{list.error.message}</p>
      <div className="history-empty-actions">
        {invalidLink && filtered && <button type="button" className="btn ghost" onClick={clear}>Limpiar filtros</button>}
        <button type="button" className="btn ghost" onClick={() => list.refetch()}>Reintentar</button>
      </div>
    </div>;
  } else if (!list.data) {
    body = <Skeleton />;
  } else if (!rows.length && !stale) {
    body = <Empty filtered={filtered} onClear={clear} />;
  } else {
    body = <>
      <ExpenseTable rows={rows} catalog={catalog.data} today={today} query={query} search={search}
        menu={menu} onMenu={setMenu} onSort={sortBy} onDelete={deleteRow} />
      {list.isFetchNextPageError ? <div className="history-page-error" role="alert">
        <p>No pudimos cargar más gastos. Los que ya ves se conservan.</p>
        <button type="button" className="btn ghost" onClick={() => list.fetchNextPage()}>Reintentar</button>
      </div> : list.hasNextPage && <button type="button" className="btn ghost pager" disabled={list.isFetchingNextPage || stale}
        onClick={() => list.fetchNextPage()}>
        {list.isFetchingNextPage ? 'Cargando más gastos…' : 'Cargar más gastos'}<Icon name="down" />
      </button>}
    </>;
  }

  return (
    <>
      {back && <Link className="btn ghost history-back" to={back}><Icon name="back" />Volver a Estadísticas</Link>}
      <HistoryFilters query={query} today={today} catalog={catalog.data} onChange={update} onClear={clear} />
      <section className="panel table-panel history-panel-list" aria-labelledby="history-title" aria-busy={list.isFetching}>
        <div className="panel-title">
          <h2 id="history-title">{listTitle(query, today)}</h2>
          <SpringSelect
            variant="compact"
            align="end"
            className="history-sort"
            aria-label="Ordenar"
            value={order.value}
            displayValue={order.short}
            menuMinWidth={200}
            options={sorts.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(value) => {
              const next = sorts.find((option) => option.value === value);
              sortBy(next.sort, next.direction);
            }}
          />
        </div>
        <p className="sr-only" aria-live="polite">
          {list.isFetching && !list.isFetchingNextPage ? 'Actualizando gastos' : `Orden: ${order.label}`}
        </p>
        {list.isRefetchError && <div className="history-page-error" role="alert">
          <p>No pudimos actualizar el historial. Se muestran los datos anteriores.</p>
          <button type="button" className="btn ghost" onClick={() => list.refetch()}>Reintentar</button>
        </div>}
        <div className={stale || (list.isFetching && !list.isFetchingNextPage && rows.length > 0) ? 'history-body updating' : 'history-body'}>
          {body}
        </div>
      </section>
      {removing && <DeleteExpenseDialog api={api} expense={removing} onClose={() => setRemoving(null)}
        onDeleted={() => {
          setRemoving(null);
          toast.success('Gasto eliminado');
        }} />}
    </>
  );
}

export function HistoryPage({ today }) {
  const api = useFinance();
  const [params] = useSearchParams();
  const id = params.get('gasto');
  if (id) {
    const back = new URLSearchParams(params);
    back.delete('gasto');
    return <ExpenseDetail api={api} id={id} back={'/historial' + (back.size ? '?' + back : '')} />;
  }
  return <HistoryList api={api} today={today} />;
}
