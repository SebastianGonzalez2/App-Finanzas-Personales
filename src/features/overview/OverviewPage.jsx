import { useMemo } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon.jsx';
import { useFinance, useRecentExpenses } from '../../lib/finance.js';
import { budgetMargin, budgetState, countsLine } from '../budgets/budgets.js';
import { Gauge } from '../budgets/Gauge.jsx';
import { rowDate, rowTitle, writeQuery } from '../history/query.js';
import { chartNumber, count, expensesCount, money, percentage, signedMoney } from '../stats/format.js';
import { categoryFilters, historyHref, periodFilters } from '../stats/links.js';
import { CategoryRow, ChartTable, HistoryLink, PanelBody } from '../stats/panels.jsx';
import { isPartial, monthLong, monthShort, readStatsQuery, statsArgs } from '../stats/query.js';
import { useStats } from '../stats/stats.js';
import { useBudgets } from '../budgets/budgets.js';

export const RECENT_LIMIT = 5;
const NEW_EXPENSE = { pathname: '/gastos/nuevo', state: { from: '/' } };

// Argumentos exactos de Resumen (RF-027). Mes actual con su referencia y últimos seis meses
// son las mismas consultas que Estadísticas abre por defecto y con «Últimos 6 meses»: la
// misma clave de get_stats, la misma respuesta y el mismo total.
export function overviewArgs(today, currency) {
  const month = readStatsQuery(new URLSearchParams(), today);
  const six = readStatsQuery(new URLSearchParams('periodo=6m'), today);
  return {
    month: statsArgs(month, currency),
    six: statsArgs(six, currency),
    recent: {
      filters: { from: month.range.from, to: month.range.to, currency },
      q: null, sort: 'spent_on', direction: 'desc', limit: RECENT_LIMIT, cursor: null,
    },
  };
}

function PanelTitle({ id, title, link }) {
  return <div className="panel-title"><h2 id={id}>{title}</h2>{link}</div>;
}

function PanelLink({ to, children, state }) {
  return <Link className="panel-link" to={to} state={state}>{children}<Icon name="up" /></Link>;
}

// Etiqueta corta sobre cada barra («1,2k», «32k»); el valor exacto está en la tabla y en el nombre accesible.
const short = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 1 });
const compact = (value) => value >= 1e6 ? short.format(value / 1e6) + 'M' : value >= 1e3 ? short.format(value / 1e3) + 'k' : short.format(value);

const monthName = (iso, today) => {
  const text = monthLong(iso.slice(0, 7));
  return iso.slice(0, 4) === today.slice(0, 4) ? text.split(' de ')[0] : text;
};

// ── Gasto del mes: total, cantidad y comparación válida con el mes anterior completo.
function MonthHero({ query, today }) {
  const data = query.data;
  return (
    <section className="panel pad hero" aria-labelledby="overview-month" aria-busy={query.isFetching}>
      <div className="hero-label">
        <h2 id="overview-month" className="eyebrow">Gasto del mes</h2>
        {data && isPartial(data.filters, today) && <span className="tag">Mes parcial</span>}
      </div>
      <PanelBody query={query} height={150} loading="Cargando el gasto del mes…">
        {data && <HeroContent data={data} today={today} />}
      </PanelBody>
    </section>
  );
}

function HeroContent({ data, today }) {
  const { filters, reference, indicator: { current, reference: base, delta, percent } } = data;
  const currency = filters.currency;
  const previous = monthName(reference.from, today);
  let comparison;
  if (delta !== null) {
    comparison = <><span className="small-data">{signedMoney(delta)} {currency}</span>
      {percent !== null && <span className="small-data"> · {percentage(percent, { sign: true })}</span>}
      <span className="hero-note"> frente a {previous} completo</span></>;
  } else if (base.count === 0) {
    comparison = <span className="hero-note">Sin base de comparación: {previous} no tiene gastos en {currency}.</span>;
  } else {
    comparison = <span className="hero-note">{previous.charAt(0).toUpperCase() + previous.slice(1)} completo: {currency} {money(base.total)}</span>;
  }
  return <>
    {current.count > 0 ? <div>
      <p className="hero-value">
        <HistoryLink filters={filters} label={`Gasto del mes: ${currency} ${money(current.total)}. Ver ${expensesCount(current.count)} en el Historial`}>{money(current.total)}</HistoryLink>
        {' '}<span className="unit">{currency}</span>
      </p>
      <p className="hero-note">{current.count === 1 ? '1 gasto registrado' : `${count(current.count)} gastos registrados`}</p>
    </div> : <div className="hero-empty">
      <p className="hero-value muted">Sin registros <span className="unit">{currency}</span></p>
      <p className="hero-note">Todavía no registraste gastos en {currency} este mes.</p>
      <Link className="btn primary" to={NEW_EXPENSE.pathname} state={NEW_EXPENSE.state}><Icon name="plus" />Registrar un gasto</Link>
    </div>}
    <div className="hero-base">{comparison}</div>
  </>;
}

// ── Evolución mensual: el mes actual y los cinco anteriores, con huecos en su lugar.
function MonthsPanel({ query, today }) {
  return (
    <section className="panel pad" aria-labelledby="overview-months" aria-busy={query.isFetching}>
      <PanelTitle id="overview-months" title="Evolución mensual" link={<PanelLink to="/estadisticas?periodo=6m">Estadísticas</PanelLink>} />
      <PanelBody query={query} height={180} loading="Cargando la evolución mensual…">
        {query.data && <SixMonths data={query.data} today={today} />}
      </PanelBody>
    </section>
  );
}

function SixMonths({ data, today }) {
  const currency = data.filters.currency;
  const months = data.months;
  const multiYear = months[0].month.slice(0, 4) !== months.at(-1).month.slice(0, 4);
  const max = Math.max(0, ...months.map((month) => chartNumber(month.total) ?? 0));
  const label = (month) => monthLong(month.month).replace(' de ', ' ') + (isPartial(month, today) ? ' · parcial' : '');
  const describe = months.map((month) => `${label(month)}: ${month.total === null ? 'sin registros' : `${currency} ${money(month.total)}`}`).join('; ');
  return <>
    <div className="month-bars" role="img" aria-label={`Gasto registrado por mes en ${currency}. ${describe}.`}>
      {months.map((month) => {
        const value = chartNumber(month.total);
        const height = value ? Math.max(3, (value / max) * 100) : 0;
        return (
          <div key={month.month} className={'month-bar' + (isPartial(month, today) ? ' current' : '') + (value ? '' : ' empty')}>
            <span className="month-value">{value ? compact(value) : '—'}</span>
            <span className="bar-area"><span className="bar" style={{ height: height + '%' }} /></span>
            <span className="month-label">{monthShort(month.month, multiYear)}</span>
          </div>
        );
      })}
    </div>
    <div className="chart-foot"><span className="key">Gasto registrado · {currency}</span>
      <span>{monthShort(months[0].month, true)} — {monthShort(months.at(-1).month, true)}</span></div>
    <ChartTable caption={`Gasto de los últimos seis meses en ${currency}. Cada mes con gastos abre el Historial.`}
      headers={['Mes', 'Gastos', currency]} numeric={[1, 2]}
      rows={months.map((month) => ({ key: month.month, cells: [
        month.count > 0 ? <HistoryLink filters={periodFilters(data.filters, month)} label={`Ver los gastos de ${label(month)}`}>{label(month)}</HistoryLink> : label(month),
        count(month.count), month.total === null ? 'Sin registros' : money(month.total),
      ] }))} />
  </>;
}

// ── Tres categorías de mayor importe, con su participación sobre el total real del mes.
function CategoriesPanel({ query }) {
  const data = query.data;
  return (
    <section className="panel pad" aria-labelledby="overview-categories" aria-busy={query.isFetching}>
      <PanelTitle id="overview-categories" title="Principales categorías" link={<PanelLink to="/estadisticas">Ver todas</PanelLink>} />
      <PanelBody query={query} height={150} loading="Cargando las categorías del mes…">
        {data && (data.categories.length === 0
          ? <p className="panel-empty">Sin gastos en {data.filters.currency} este mes.</p>
          : <>
            <p className="eyebrow">Importe en {data.filters.currency} · % del mes</p>
            <ul className="cat-list">
              {data.categories.slice(0, 3).map((category) => (
                <li key={category.id}>
                  <Link className="cat-row" to={historyHref(categoryFilters(data.filters, category.id))}
                    aria-label={`${category.name}: ${data.filters.currency} ${money(category.total)}, ${percentage(category.share)} del mes, ${expensesCount(category.count)}. Ver gastos`}>
                    <CategoryRow name={category.name} total={category.total} share={category.share} count={category.count} currency={data.filters.currency} />
                  </Link>
                </li>
              ))}
            </ul>
            {data.categories.length > 3 && <p className="panel-note">
              {data.categories.length - 3 === 1 ? 'Otra categoría' : `Otras ${data.categories.length - 3} categorías`} en Estadísticas.</p>}
          </>)}
      </PanelBody>
    </section>
  );
}

// ── Presupuestos de la moneda: destaca el mayor porcentaje utilizado.
function BudgetsPanel({ query }) {
  const data = query.data;
  const top = data?.items[0];
  return (
    <section className="panel pad" aria-labelledby="overview-budgets" aria-busy={query.isFetching}>
      <PanelTitle id="overview-budgets" title="Presupuestos" link={<PanelLink to="/presupuestos">Ver límites</PanelLink>} />
      <PanelBody query={query} height={150} loading="Cargando presupuestos…">
        {data && (top ? <BudgetFeature item={top} items={data.items} /> : <div className="budget-none">
          <p className="panel-empty">Todavía no tenés límites mensuales en {data.currency}.</p>
          <Link className="btn" to="/presupuestos" state={{ create: true }}><Icon name="plus" />Crear presupuesto</Link>
        </div>)}
      </PanelBody>
    </section>
  );
}

function BudgetFeature({ item, items }) {
  const state = budgetState(item);
  const margin = budgetMargin(item);
  return <>
    <div className="budget-feature">
      <Gauge percent={item.percent} over={margin.over} />
      <div>
        <span className={'tag ' + state.tone}>{state.label}</span>
        <h3>{item.category_name}</h3>
        <p className="figure">{money(margin.amount)} <span className="unit">{item.currency}</span></p>
        <p className="hero-note">{margin.over ? 'por encima del límite mensual' : `disponibles de ${money(item.monthly_limit)}`}</p>
      </div>
    </div>
    <p className="bottom-rule small-data">{countsLine(items)}</p>
  </>;
}

// ── Gastos recientes del mes y la moneda de la pantalla (una página corta de list_expenses).
function RecentPanel({ query, filters, today }) {
  const data = query.data;
  const params = writeQuery({ q: '', ...filters, category: '', subcategory: '', sort: 'spent_on', direction: 'desc' });
  return (
    <section className="panel table-panel overview-recent" aria-labelledby="overview-recent" aria-busy={query.isFetching}>
      <PanelTitle id="overview-recent" title="Gastos recientes" link={<PanelLink to={'/historial?' + params}>Ver historial</PanelLink>} />
      {!data ? <div className="recent-state"><PanelBody query={query} height={120} loading="Cargando gastos recientes…">{null}</PanelBody></div>
        : data.items.length === 0 ? <div className="history-empty">
          <h3>Sin gastos en {filters.currency} este mes</h3>
          <p>Los gastos de {monthLong(filters.from.slice(0, 7))} en {filters.currency} van a aparecer acá.</p>
        </div>
          : <div className={query.isFetching ? 'panel-data updating' : 'panel-data'}>
            <table className="expense-table recent-table">
              <thead><tr><th scope="col">Descripción</th><th scope="col">Categoría</th><th scope="col">Fecha</th><th scope="col" className="right">Importe</th></tr></thead>
              <tbody>
                {data.items.map((expense) => {
                  const detail = new URLSearchParams(params);
                  detail.set('gasto', expense.id);
                  const classification = expense.category_name + (expense.subcategory_name ? ' · ' + expense.subcategory_name : '');
                  return (
                    <tr key={expense.id}>
                      <td><div className="entry">
                        <span className="tile" aria-hidden="true"><Icon name="historial" /></span>
                        <div className="entry-text">
                          <Link className="row-link" to={'/historial?' + detail}>{rowTitle(expense)}</Link>
                          <small className="desk-only">{expense.subcategory_name ?? '—'}</small>
                          <small className="mobile-only">{rowDate(expense.spent_on, today)} · {classification}</small>
                        </div>
                      </div></td>
                      <td className="hide-phone">{expense.category_name}</td>
                      <td className="hide-phone small-data"><time dateTime={expense.spent_on}>{rowDate(expense.spent_on, today, true)}</time></td>
                      <td className="right money"><small>{expense.currency}</small>{money(expense.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
    </section>
  );
}

const QUICK = [
  { to: NEW_EXPENSE.pathname, state: NEW_EXPENSE.state, icon: 'plus', title: 'Registrar gasto', note: 'Importe, fecha y categoría' },
  { to: '/historial', icon: 'historial', title: 'Historial', note: 'Buscar, editar y eliminar' },
  { to: '/estadisticas', icon: 'estadisticas', title: 'Estadísticas', note: 'Períodos y categorías' },
  { to: '/presupuestos', icon: 'presupuestos', title: 'Presupuestos', note: 'Límites mensuales' },
];

// / · Resumen (RF-027). Cuatro lecturas en paralelo, cada bloque con su carga y su error.
export function OverviewPage({ preferences }) {
  const api = useFinance();
  const { today, currency } = preferences;
  const args = useMemo(() => overviewArgs(today, currency), [today, currency]);
  const month = useStats(api, args.month);
  const six = useStats(api, args.six);
  const budgets = useBudgets(api, currency);
  const recent = useRecentExpenses(api, args.recent);
  return (
    <div className="overview">
      <div className="overview-grid">
        <MonthHero query={month} today={today} />
        <MonthsPanel query={six} today={today} />
      </div>
      <div className="overview-grid">
        <CategoriesPanel query={month} />
        <BudgetsPanel query={budgets} />
      </div>
      <RecentPanel query={recent} filters={args.recent.filters} today={today} />
      <nav className="quick-actions" aria-label="Accesos rápidos">
        {QUICK.map((item) => (
          <Link key={item.to} className="quick-action" to={item.to} state={item.state}>
            <span className="tile" aria-hidden="true"><Icon name={item.icon} /></span>
            <span><strong>{item.title}</strong><small>{item.note}</small></span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
