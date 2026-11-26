import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useToast } from '../../app/toastContext.js';
import { Icon } from '../../components/Icon.jsx';
import { QueryState } from '../../components/QueryState.jsx';
import { useCatalog, useExpense } from '../../lib/finance.js';
import { displayAmount, displayDate } from '../expenses/draft.js';
import { DeleteExpenseDialog } from './DeleteExpenseDialog.jsx';

// Full record opened from a history row or a direct link (/historial?gasto=<id>).
export function ExpenseDetail({ api, id, back }) {
  const expense = useExpense(api, id);
  const catalog = useCatalog(api);
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const backLink = <Link className="btn ghost" to={back}><Icon name="back" />Volver al historial</Link>;
  if (expense.isError || !expense.data) return <div className="history-detail-wrap">
    <QueryState query={expense} loading="Cargando gasto…" />
    {expense.isError && <div className="form-actions detail-back">{backLink}</div>}
  </div>;
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
        <dt>Descripción</dt><dd>{row.description ?? <span className="muted-text">Sin descripción</span>}</dd>
        {row.is_recurring && (
          <>
            <dt>Origen</dt>
            <dd>
              <span className="recurring-badge">
                <Icon name="recurrentes" />Pago recurrente automático
              </span>
            </dd>
          </>
        )}
      </dl>
      <div className="form-actions">
        <button type="button" className="btn ghost danger delete-trigger" onClick={() => setConfirm(true)}>
          <Icon name="trash" />Eliminar gasto
        </button>
        {backLink}
        <Link className="btn primary" to={'/gastos/' + id + '/editar'} state={{ from: back }}>
          <Icon name="edit" />Editar gasto
        </Link>
      </div>
      {confirm && <DeleteExpenseDialog api={api} expense={row} onClose={() => setConfirm(false)}
        onDeleted={() => {
          toast.success('Gasto eliminado');
          navigate(back, { replace: true });
        }} />}
    </section>
  );
}
