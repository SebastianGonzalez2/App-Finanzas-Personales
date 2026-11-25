import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useToast } from '../../app/toastContext.js';
import { Icon } from '../../components/Icon.jsx';
import { useCatalog, useFinance } from '../../lib/finance.js';
import { figureSize, money, percentage } from '../stats/format.js';
import { PanelBody } from '../stats/panels.jsx';
import { BudgetFormDialog, BudgetMenu, RetireBudgetDialog } from './BudgetDialogs.jsx';
import { barWidth, budgetMargin, budgetState, countsLine, useBudgets } from './budgets.js';
import { Gauge } from './Gauge.jsx';

function Track({ item, state }) {
  return <span className="track" aria-hidden="true"><span className={'fill ' + state.tone} style={{ width: barWidth(item.percent) + '%' }} /></span>;
}

function Name({ item, archived }) {
  return <span className="cat-name">{item.category_name}{archived && <small className="archived-mark">Archivada</small>}</span>;
}

// Límite destacado: el mayor porcentaje utilizado (primer elemento del orden del servidor).
export function BudgetHighlight({ item, title = 'Mayor uso del límite' }) {
  const state = budgetState(item);
  const margin = budgetMargin(item);
  return (
    <section className="panel pad highlight" aria-labelledby="budget-highlight">
      <div className="panel-title"><h2 id="budget-highlight">{title}</h2><span className={'tag ' + state.tone}>{state.label}</span></div>
      <div className="gauge-wrap">
        <Gauge percent={item.percent} over={margin.over} />
        <div>
          <div className="eyebrow">{item.category_name}</div>
          <p className="figure" data-size={figureSize(money(margin.amount))}>{money(margin.amount)} <span className="unit">{item.currency}</span></p>
          <p className="hero-note">{margin.over ? 'de exceso este mes' : state.key === 'reached' ? 'restantes: el consumo igualó el límite' : 'disponibles este mes'}</p>
        </div>
      </div>
      <p className="bottom-rule small-data">{item.currency} {money(item.spent)} de {money(item.monthly_limit)}</p>
    </section>
  );
}

function BudgetTable({ items, currency, archived, menu }) {
  return (
    <table className="budget-table">
      <caption className="sr-only">Límites mensuales en {currency}, ordenados por porcentaje utilizado</caption>
      <thead><tr>
        <th scope="col">Categoría</th><th scope="col" className="right">Gastado · {currency}</th>
        <th scope="col" className="right">Límite · {currency}</th><th scope="col" className="right">Margen</th>
        <th scope="col" className="usage">Uso</th><th scope="col"><span className="sr-only">Acciones</span></th>
      </tr></thead>
      <tbody>
        {items.map((item) => {
          const state = budgetState(item);
          const margin = budgetMargin(item);
          return (
            <tr key={item.category_id} data-budget={item.category_id}>
              <th scope="row"><Name item={item} archived={archived(item.category_id)} /><small className={'budget-state ' + state.tone}>{state.label}</small></th>
              <td className="right money">{money(item.spent)}</td>
              <td className="right money">{money(item.monthly_limit)}</td>
              <td className={'right money' + (margin.over ? ' neg' : '')} title={margin.over ? 'Exceso sobre el límite' : 'Margen restante'}>{money(margin.amount)}</td>
              <td className="usage">
                <div className="usage-meter">
                  <span className={'budget-percent ' + state.tone}>{percentage(item.percent)}</span>
                  <Track item={item} state={state} />
                </div>
              </td>
              <td className="actions-cell">{menu(item)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BudgetCards({ items, archived, menu }) {
  return (
    <ul className="budget-cards">
      {items.map((item) => {
        const state = budgetState(item);
        const margin = budgetMargin(item);
        return (
          <li key={item.category_id} className="budget-card" data-budget={item.category_id}>
            <div className="budget-card-head">
              <div><h3><Name item={item} archived={archived(item.category_id)} /></h3><small className={'budget-state ' + state.tone}>{state.label}</small></div>
              <div className="budget-card-tools"><span className={'budget-percent ' + state.tone}>{percentage(item.percent)}</span>{menu(item)}</div>
            </div>
            <Track item={item} state={state} />
            <dl className="facts">
              <div><dt>Gastado</dt><dd>{money(item.spent)} {item.currency}</dd></div>
              <div><dt>Límite</dt><dd>{money(item.monthly_limit)} {item.currency}</dd></div>
              <div><dt>{margin.label}</dt><dd className={margin.over ? 'neg' : undefined}>{money(margin.amount)} {item.currency}</dd></div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

// UI-01: tabla desde 1181 px y tarjetas por debajo. Se monta una sola de las dos vistas, para
// que cada límite tenga un único menú (y un único id) en el documento.
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

// /presupuestos (RF-021, RF-024 a RF-026): límites del mes civil actual en la moneda elegida.
export function BudgetsPage({ preferences }) {
  const api = useFinance();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { currency } = preferences;
  const budgets = useBudgets(api, currency);
  const catalog = useCatalog(api);
  const [dialog, setDialog] = useState(() => (location.state?.create ? { kind: 'form', budget: null } : null));
  const [menu, setMenu] = useState(null);
  const compact = useCompact();

  // «Crear presupuesto» desde el Resumen abre el formulario una sola vez (no al volver atrás).
  useEffect(() => {
    if (location.state?.create) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const toggle = useCallback((id) => setMenu(id), []);
  const archived = (id) => Boolean(catalog.data?.categories.find((row) => row.id === id)?.archived);
  const openForm = (budget = null) => { setDialog({ kind: 'form', budget }); };
  const rowMenu = (item) => <BudgetMenu budget={item} open={menu === item.category_id} onToggle={toggle}
    onEdit={(budget) => openForm(budget)} onRetire={(budget) => { setDialog({ kind: 'retire', budget }); }} />;
  const close = () => setDialog(null);
  const done = (text) => { setDialog(null); toast.success(text); };

  const data = budgets.data;
  const items = data?.items ?? [];
  const create = <button type="button" className="btn" onClick={() => openForm()}><Icon name="plus" />Crear límite</button>;
  return (
    <>
      <div className={'budget-page' + (data && items.length ? '' : ' single')}>
        {data && items.length > 0 && <BudgetHighlight item={items[0]} />}
        <section className="panel table-panel budget-list" aria-labelledby="budget-list-title" aria-busy={budgets.isFetching}>
          <div className="panel-title">
            <h2 id="budget-list-title">Mis límites{data && <span className="sr-only"> en {data.currency}</span>}</h2>
            {create}
          </div>
          <div className="budget-body">
            <PanelBody query={budgets} height={180} loading="Cargando presupuestos…">
              {data && (items.length === 0 ? (
                <div className="budget-empty">
                  <h3>Todavía no tenés límites en {data.currency}</h3>
                  <p>Un límite mensual cuenta los gastos registrados de una categoría, incluidas sus subcategorías, en {data.currency}.
                    No reserva dinero ni mueve saldos. Al empezar cada mes el consumo vuelve a calcularse y el límite se mantiene.</p>
                  <button type="button" className="btn primary" onClick={() => openForm()}><Icon name="plus" />Crear límite</button>
                </div>
              ) : <>
                <p className="budget-meta small-data">{countsLine(items)} · {data.currency}</p>
                {compact ? <BudgetCards items={items} archived={archived} menu={rowMenu} />
                  : <BudgetTable items={items} currency={data.currency} archived={archived} menu={rowMenu} />}
              </>)}
            </PanelBody>
          </div>
        </section>
      </div>
      {dialog?.kind === 'form' && (catalog.data
        ? <BudgetFormDialog api={api} initial={dialog.budget} catalog={catalog.data} currency={currency} onClose={close} onDone={done} />
        : <CatalogWait query={catalog} onClose={close} />)}
      {dialog?.kind === 'retire' && <RetireBudgetDialog api={api} budget={dialog.budget} onClose={close} onDone={done} />}
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
