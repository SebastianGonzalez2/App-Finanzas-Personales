import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon.jsx';
import { QueryState } from '../../components/QueryState.jsx';
import { useCatalog, useExpense, useFinance } from '../../lib/finance.js';
import { displayAmount, displayDate } from './draft.js';

function Detail({ api, id }) {
  const expense = useExpense(api, id);
  const catalog = useCatalog(api);
  if (expense.isError || !expense.data) return <QueryState query={expense} loading="Cargando gasto…" />;
  if (catalog.isError || !catalog.data) return <QueryState query={catalog} loading="Cargando categorías…" />;
  const row = expense.data;
  const parent = catalog.data.categories.find((item) => item.id === row.category_id);
  const child = catalog.data.subcategories.find((item) => item.id === row.subcategory_id);
  return (
    <section className="expense-card history-detail" aria-label="Detalle del gasto">
      <div className="amount-hero">
        <span className="eyebrow">Importe</span>
        <p className="history-amount">{displayAmount(row.amount)} <span>{row.currency}</span></p>
      </div>
      <dl>
        <dt>Fecha</dt><dd><time dateTime={row.spent_on}>{displayDate(row.spent_on)}</time></dd>
        <dt>Categoría</dt><dd>{parent?.name ?? row.category_name} {parent?.archived && <small>Archivada</small>}</dd>
        <dt>Subcategoría</dt><dd>{child?.name ?? row.subcategory_name ?? 'Sin subcategoría'}{' '}
          {row.subcategory_id && (parent?.archived || child?.archived) && <small>Archivada</small>}</dd>
        {row.description && <><dt>Descripción</dt><dd>{row.description}</dd></>}
      </dl>
      <div className="form-actions"><Link className="btn ghost" to={'/gastos/' + id + '/editar'} state={{ from: '/historial' }}>
        <Icon name="edit" />Editar gasto
      </Link></div>
    </section>
  );
}

export function ExpenseDetail() {
  const api = useFinance();
  const [params] = useSearchParams();
  const location = useLocation();
  const id = params.get('gasto');
  if (id) return <Detail api={api} id={id} />;
  if (api.memory.lastExpenseId) return <Navigate replace state={location.state}
    to={'/historial?gasto=' + encodeURIComponent(api.memory.lastExpenseId)} />;
  return <p className="query-state">Acá podés volver al último gasto que guardes o consultes en esta sesión.</p>;
}
