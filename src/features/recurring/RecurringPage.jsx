import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../app/toastContext.js';
import { Icon } from '../../components/Icon.jsx';
import { useCatalog, useFinance } from '../../lib/finance.js';
import { money } from '../stats/format.js';
import { PanelBody } from '../stats/panels.jsx';
import { DeleteRecurringDialog, RecurringFormDialog, RecurringMenu } from './RecurringDialogs.jsx';
import {
  computeCurrencyTotals,
  formatBillingDay,
  formatNextBillingDate,
  useRecurringPayments,
} from './recurring.js';

const COMPACT = '(max-width: 1180px)';

function useCompact() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT).matches);
  useEffect(() => {
    const media = window.matchMedia(COMPACT);
    const change = (event) => setCompact(event.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return compact;
}

function Classification({ item }) {
  return (
    <span className="recurring-class">
      <span>
        {item.category_name}
        {item.category_archived && <small className="archived-mark">Archivada</small>}
      </span>
      {item.subcategory_name && (
        <small className="recurring-sub">
          {item.subcategory_name}
          {item.subcategory_archived && ' · Archivada'}
        </small>
      )}
    </span>
  );
}

function RecurringTable({ items, today, menu }) {
  return (
    <table className="recurring-table">
      <caption className="sr-only">Pagos recurrentes mensuales activos</caption>
      <thead>
        <tr>
          <th scope="col">Nombre</th>
          <th scope="col">Categoría</th>
          <th scope="col">Cobro mensual</th>
          <th scope="col">Próximo registro</th>
          <th scope="col" className="right">Importe</th>
          <th scope="col"><span className="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} data-recurring={item.id}>
            <th scope="row">
              <div className="recurring-name-cell">
                <span className="tile" aria-hidden="true"><Icon name="recurrentes" /></span>
                <div>
                  <span className="recurring-title">{item.name}</span>
                  {item.needs_attention && (
                    <small className="recurring-warn">
                      Categoría archivada · Revisar configuración
                    </small>
                  )}
                </div>
              </div>
            </th>
            <td><Classification item={item} /></td>
            <td className="small-data">{formatBillingDay(item.billing_day)}</td>
            <td className="small-data">
              <time dateTime={item.next_billing_date}>{formatNextBillingDate(item.next_billing_date, today)}</time>
            </td>
            <td className="right money">
              <small>{item.currency}</small>{money(item.amount)}
            </td>
            <td className="actions-cell">{menu(item)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecurringCards({ items, today, menu }) {
  return (
    <ul className="recurring-cards">
      {items.map((item) => (
        <li key={item.id} className="recurring-card" data-recurring={item.id}>
          <div className="recurring-card-head">
            <div className="recurring-name-cell">
              <span className="tile" aria-hidden="true"><Icon name="recurrentes" /></span>
              <div>
                <h3>{item.name}</h3>
                <Classification item={item} />
              </div>
            </div>
            <div className="recurring-card-tools">
              <span className="money"><small>{item.currency}</small>{money(item.amount)}</span>
              {menu(item)}
            </div>
          </div>
          {item.needs_attention && (
            <p className="recurring-warn" role="status">
              Categoría archivada · Editá este pago para reanudar sus registros automáticos.
            </p>
          )}
          <dl className="recurring-facts">
            <div>
              <dt>Cobro mensual</dt>
              <dd>{formatBillingDay(item.billing_day)}</dd>
            </div>
            <div>
              <dt>Próximo registro</dt>
              <dd><time dateTime={item.next_billing_date}>{formatNextBillingDate(item.next_billing_date, today)}</time></dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export function RecurringPage({ preferences }) {
  const api = useFinance();
  const toast = useToast();
  const { currency, today } = preferences;
  const recurring = useRecurringPayments(api);
  const catalog = useCatalog(api);
  const compact = useCompact();

  const [dialog, setDialog] = useState(null);
  const [menu, setMenu] = useState(null);

  const items = useMemo(() => recurring.data?.items ?? [], [recurring.data]);
  const totals = useMemo(() => computeCurrencyTotals(items), [items]);
  const attentionCount = useMemo(() => items.filter((item) => item.needs_attention).length, [items]);
  const serverToday = recurring.data?.today ?? today;

  const toggle = useCallback((id) => setMenu(id), []);
  const openCreate = () => setDialog({ kind: 'form', item: null });
  const close = () => setDialog(null);
  const done = (text) => {
    setDialog(null);
    toast.success(text);
  };

  const rowMenu = (item) => (
    <RecurringMenu
      item={item}
      open={menu === item.id}
      onToggle={toggle}
      onEdit={(entry) => setDialog({ kind: 'form', item: entry })}
      onDelete={(entry) => setDialog({ kind: 'delete', item: entry })}
    />
  );

  return (
    <>
      <div className="recurring-page">
        <div className="recurring-summary-grid">
          <section className="panel pad recurring-stat" aria-label="Pagos recurrentes activos">
            <span className="eyebrow">Activos</span>
            <p className="recurring-stat-value">
              {recurring.data ? items.length : '—'}{' '}
              <span className="unit">{items.length === 1 ? 'pago mensual' : 'pagos mensuales'}</span>
            </p>
            <p className="hero-note">Se registran automáticamente en su fecha de cobro.</p>
          </section>

          <section className="panel pad recurring-stat recurring-totals" aria-label="Total mensual programado por moneda">
            <span className="eyebrow">Total mensual programado</span>
            {recurring.isError ? (
              <p className="recurring-stat-value muted">No disponible</p>
            ) : !recurring.data ? (
              <p className="hero-note">Calculando totales…</p>
            ) : totals.length === 0 ? (
              <p className="recurring-stat-value muted">Sin importes programados</p>
            ) : (
              <dl className="recurring-currency-list">
                {totals.map((entry) => (
                  <div key={entry.currency} className="recurring-currency-item" data-currency={entry.currency}>
                    <dt>{entry.currency}</dt>
                    <dd className="money">{money(entry.total)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="hero-note">Totales separados por moneda, sin conversiones.</p>
          </section>
        </div>

        {attentionCount > 0 && (
          <div className="recurring-banner" role="alert">
            <Icon name="info" />
            <span>
              {attentionCount === 1
                ? 'Hay 1 pago recurrente con una categoría o subcategoría archivada. Editalo para reanudar su registro automático.'
                : `Hay ${attentionCount} pagos recurrentes con categorías o subcategorías archivadas. Editalos para reanudar su registro automático.`}
            </span>
          </div>
        )}

        <section className="panel table-panel recurring-list" aria-labelledby="recurring-list-title" aria-busy={recurring.isFetching}>
          <div className="panel-title">
            <h2 id="recurring-list-title">Programación mensual</h2>
            <button type="button" className="btn primary" onClick={openCreate}>
              <Icon name="plus" />Nuevo pago recurrente
            </button>
          </div>
          <div className="recurring-body">
            {recurring.isError ? (
              <div className="panel-state" role="alert">
                <p>No pudimos cargar los pagos recurrentes. {recurring.error.message}</p>
                <div className="panel-state-actions">
                  <button type="button" className="btn ghost" onClick={() => recurring.refetch()}>Reintentar</button>
                </div>
              </div>
            ) : (
              <PanelBody query={recurring} height={180} loading="Cargando pagos recurrentes…">
                {recurring.data && (items.length === 0 ? (
                  <div className="recurring-empty">
                    <h3>Todavía no configuraste pagos recurrentes</h3>
                    <p>
                      Agregá tus gastos mensuales fijos (como suscripciones, alquiler o servicios) y Cifra los registrará automáticamente en el Historial cada mes.
                    </p>
                  </div>
                ) : (
                  compact
                    ? <RecurringCards items={items} today={serverToday} menu={rowMenu} />
                    : <RecurringTable items={items} today={serverToday} menu={rowMenu} />
                ))}
              </PanelBody>
            )}
          </div>
        </section>
      </div>

      {dialog?.kind === 'form' && (catalog.data ? (
        <RecurringFormDialog
          api={api}
          initial={dialog.item}
          catalog={catalog.data}
          currency={currency}
          today={serverToday}
          onClose={close}
          onDone={done}
        />
      ) : (
        <CatalogWait query={catalog} onClose={close} />
      ))}

      {dialog?.kind === 'delete' && (
        <DeleteRecurringDialog
          api={api}
          item={dialog.item}
          onClose={close}
          onDone={done}
        />
      )}
    </>
  );
}

function CatalogWait({ query, onClose }) {
  return (
    <div className="budget-wait" role={query.isError ? 'alert' : 'status'}>
      {query.isError ? 'No pudimos cargar las categorías.' : 'Cargando categorías…'}
      {query.isError && <button type="button" className="btn ghost" onClick={() => query.refetch()}>Reintentar</button>}
      <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
    </div>
  );
}
