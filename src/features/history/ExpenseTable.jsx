import { memo, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon.jsx';
import { displayAmount } from '../expenses/draft.js';
import { rowDate, rowTitle } from './query.js';

function RowMenu({ expense, title, open, onToggle, editTo, onDelete }) {
  const menu = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    menu.current.querySelector('a, button').focus();
    function outside(event) { if (!menu.current?.parentElement.contains(event.target)) onToggle(null); }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, onToggle]);
  return (
    <div className="row-menu" onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.stopPropagation(); onToggle(null); event.currentTarget.querySelector('button').focus(); }
    }}>
      <button type="button" className="square row-menu-trigger" aria-label={'Acciones para ' + title} title="Acciones"
        aria-expanded={open} aria-controls={open ? 'menu-' + expense.id : undefined}
        onClick={() => onToggle(open ? null : expense.id)}>
        <Icon name="more" />
      </button>
      {open && <div ref={menu} id={'menu-' + expense.id} className="row-menu-list" role="group" aria-label={'Acciones para ' + title}>
        <Link to={editTo.pathname} state={editTo.state}><Icon name="edit" />Editar</Link>
        <button type="button" className="danger" onClick={() => { onToggle(null); onDelete(expense); }}><Icon name="trash" />Eliminar</button>
      </div>}
    </div>
  );
}

const Row = memo(function Row({ expense, archived, today, detailTo, editFrom, menuOpen, onMenu, onDelete }) {
  const title = rowTitle(expense);
  const classification = expense.category_name + (expense.subcategory_name ? ' · ' + expense.subcategory_name : '');
  const detail = expense.description ? expense.subcategory_name ?? '—' : expense.subcategory_name ? expense.category_name : 'Sin descripción';
  return (
    <tr>
      <td>
        <div className="entry">
          <span className="tile" aria-hidden="true"><Icon name="historial" /></span>
          <div className="entry-text">
            <Link className="row-link" to={detailTo}>{title}</Link>
            <small className="desk-only">{detail}</small>
            <small className="mobile-only">{rowDate(expense.spent_on, today)} · {classification}{archived && ' · Archivada'}</small>
          </div>
        </div>
      </td>
      <td className="hide-phone">{expense.category_name}{archived && <small className="archived-mark">Archivada</small>}</td>
      <td className="hide-phone small-data"><time dateTime={expense.spent_on}>{rowDate(expense.spent_on, today, true)}</time></td>
      <td className="right money"><small>{expense.currency}</small>{displayAmount(expense.amount)}</td>
      <td className="hide-phone actions-cell">
        <RowMenu expense={expense} title={title} open={menuOpen} onToggle={onMenu} onDelete={onDelete}
          editTo={{ pathname: '/gastos/' + expense.id + '/editar', state: { from: editFrom } }} />
      </td>
    </tr>
  );
});

function SortHeader({ label, column, query, onSort }) {
  const active = query.sort === column;
  const descending = query.direction === 'desc';
  return (
    <th aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'} className={column === 'amount' ? 'right' : undefined}>
      <button type="button" className="sort-button" onClick={() => onSort(column, active ? (descending ? 'asc' : 'desc') : 'desc')}>
        {label}{active && <span aria-hidden="true"> {descending ? '↓' : '↑'}</span>}
        <span className="sr-only">{active ? (descending ? ', orden descendente' : ', orden ascendente') : ', ordenar'}</span>
      </button>
    </th>
  );
}

export function ExpenseTable({ rows, catalog, today, query, search, menu, onMenu, onSort, onDelete }) {
  const archivedParents = new Set(catalog?.categories.filter((row) => row.archived).map((row) => row.id));
  const archivedChildren = new Set(catalog?.subcategories.filter((row) => row.archived).map((row) => row.id));
  const base = new URLSearchParams(search);
  base.delete('gasto');
  const from = '/historial' + (base.size ? '?' + base : '');
  return (
    <table className="expense-table">
      <thead>
        <tr>
          <th scope="col">Descripción</th>
          <th scope="col">Categoría</th>
          <SortHeader label="Fecha" column="spent_on" query={query} onSort={onSort} />
          <SortHeader label="Importe" column="amount" query={query} onSort={onSort} />
          <th scope="col"><span className="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((expense) => {
          const params = new URLSearchParams(base);
          params.set('gasto', expense.id);
          return <Row key={expense.id} expense={expense} today={today} editFrom={from}
            archived={archivedParents.has(expense.category_id) || archivedChildren.has(expense.subcategory_id)}
            detailTo={'/historial?' + params} menuOpen={menu === expense.id} onMenu={onMenu} onDelete={onDelete} />;
        })}
      </tbody>
    </table>
  );
}
