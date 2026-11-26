import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon.jsx';
import { CategoryDonut } from './CategoryDonut.jsx';
import { chartNumber, count, expensesCount, figureSize, money, percentage, signedMoney } from './format.js';
import { donutPeriodCopy } from './insights.js';
import { categoryFilters, childFilters, historyHref, periodFilters } from './links.js';
import { breakdownArgs, dayShort, isOpen, isPartial, monthLong, monthShort } from './query.js';
import { useStats } from './stats.js';
import { describeStats } from './summary.js';
import './FavoriteStar.css';

export const MonthlyChart = lazy(() => import('./charts.jsx').then((module) => ({ default: module.MonthlyChart })));

const rangeDays = ({ from, to }) => `${dayShort(from)} – ${dayShort(to)}`;
const mobile = () => window.matchMedia('(max-width: 620px)').matches;

// Animación de la estrella adaptada del botón «Favorite» de Amicro (MIT); ver FavoriteStar.css.
export function FavoriteButton({ title, pressed, pending, onToggle }) {
  // Solo anima después de un clic en este botón: al cargar la pantalla, o si los favoritos cambian
  // por otra vía, la estrella muestra su estado sin animación.
  const [animated, setAnimated] = useState(false);
  return (
    <button type="button" className="square fav" aria-pressed={pressed} disabled={pending}
      data-animated={animated || undefined}
      aria-label={pressed ? `Quitar «${title}» de Mis favoritos` : `Agregar «${title}» a Mis favoritos`}
      title={pressed ? 'Quitar de Mis favoritos' : 'Agregar a Mis favoritos'}
      onClick={() => { setAnimated(true); onToggle(); }}>
      <span className="fav-star" aria-hidden="true">
        <span className="fav-star-layer fav-star-off"><Icon name="star" /></span>
        <span className="fav-star-layer fav-star-on"><Icon name="star" /></span>
      </span>
    </button>
  );
}

export function StatsPanel({ panel, favorite, tools, busy, children }) {
  return (
    <section className={'panel pad stats-panel' + (panel.span ? ' span-2' : '')} aria-labelledby={'panel-' + panel.id}
      aria-busy={busy} data-panel={panel.id}>
      <div className="panel-title">
        <h2 id={'panel-' + panel.id}>{panel.title}</h2>
        <div className="panel-tools">{tools}{favorite}</div>
      </div>
      {children}
    </section>
  );
}

// Carga inicial con altura reservada, error recuperable y «Actualizando» al releer la misma clave.
export function PanelBody({ query, height = 160, onClear, loading = 'Cargando estadísticas…', children }) {
  if (query.isError) {
    const invalid = query.error.status === 404 || query.error.status === 422;
    return (
      <div className="panel-state" role="alert">
        <p>{invalid ? 'No pudimos aplicar estos filtros. ' : 'No pudimos cargar este panel. '}{query.error.message}</p>
        <div className="panel-state-actions">
          {invalid && onClear && <button type="button" className="btn ghost" onClick={onClear}>Limpiar filtros</button>}
          <button type="button" className="btn ghost" onClick={() => query.refetch()}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!query.data) {
    return <div className="panel-skeleton" style={{ minHeight: height }} role="status"><span className="sr-only">{loading}</span></div>;
  }
  return <div className={query.isFetching ? 'panel-data updating' : 'panel-data'}>
    {query.isFetching && <span className="sr-only" role="status">Actualizando</span>}
    {children}
  </div>;
}

export function ChartTable({ caption, headers, rows, numeric = [] }) {
  const [open] = useState(mobile);
  return (
    <details className="chart-details" open={open}>
      <summary>Ver datos</summary>
      <div className="chart-table-wrap">
        <table className="chart-table">
          <caption className="sr-only">{caption}</caption>
          <thead><tr>{headers.map((header, index) => <th key={index} scope="col" className={numeric.includes(index) ? 'right' : undefined}>{header}</th>)}</tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.key}>{row.cells.map((cell, index) => index === 0
              ? <th key={index} scope="row">{cell}</th>
              : <td key={index} className={numeric.includes(index) ? 'right' : undefined}>{cell}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

export function HistoryLink({ filters, back, children, label }) {
  return <Link className="history-link" to={historyHref(filters, back)} aria-label={label}>{children}</Link>;
}

function variationNote(data, today) {
  const { current, reference } = data.indicator;
  if (current.count === 0) return 'Sin registros en el período';
  if (reference.count === 0) return 'Sin base de comparación';
  if (data.indicator.percent !== null) return 'vs. referencia';
  return isOpen(data.filters, today) || isOpen(data.reference, today) ? 'Período en curso' : 'Duraciones distintas';
}

// ── Indicadores del período (RF-017).
export function MetricsContent({ data, today, back }) {
  const { filters, indicator: { current, reference, delta, percent } } = data;
  const currency = filters.currency;
  const amount = (metric, range, label) => metric.count
    ? <HistoryLink filters={periodFilters(filters, range)} back={back} label={`${label}: ${currency} ${money(metric.total)}. Ver ${expensesCount(metric.count)} en el Historial`}>{money(metric.total)}</HistoryLink>
    : <span className="muted-figure">Sin registros</span>;
  return <>
    <dl className="metrics">
      <div>
        <dt className="eyebrow">Total gastado</dt>
        <dd className="figure" data-size={current.count ? figureSize(money(current.total)) : undefined}>{amount(current, filters, 'Total gastado')} {current.count > 0 && <span className="unit">{currency}</span>}</dd>
      </div>
      <div>
        <dt className="eyebrow">Cantidad</dt>
        <dd className="figure">{count(current.count)} <span className="unit">{current.count === 1 ? 'gasto' : 'gastos'}</span></dd>
      </div>
      {data.reference && <>
        <div>
          <dt className="eyebrow">Referencia</dt>
          <dd className="figure" data-size={reference.count ? figureSize(money(reference.total)) : undefined}>{amount(reference, data.reference, 'Total de referencia')} {reference.count > 0 && <span className="unit">{currency}</span>}</dd>
          <dd className="metric-note">{expensesCount(reference.count)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Diferencia</dt>
          <dd className="figure" data-size={delta === null ? undefined : figureSize(signedMoney(delta))}>{delta === null ? <span className="muted-figure">No disponible</span> : <>{signedMoney(delta)} <span className="unit">{currency}</span></>}</dd>
        </div>
        <div>
          <dt className="eyebrow">Variación</dt>
          <dd className="figure">{percent === null ? <span className="muted-figure">{current.count && reference.count ? 'No comparable' : 'No disponible'}</span> : percentage(percent, { sign: true })}</dd>
          <dd className="metric-note">{variationNote(data, today)}</dd>
        </div>
      </>}
    </dl>
    <p className="period-line">
      <span><b>Actual</b> · {rangeDays(filters)}{isPartial(filters, today) && ' · parcial'}</span>
      {data.reference ? <span><b>Referencia</b> · {rangeDays(data.reference)}{isPartial(data.reference, today) && ' · parcial'}</span>
        : <span>Sin período de referencia</span>}
    </p>
  </>;
}

// ── Gastos por mes (RF-019). Bloques de 60 meses según ARCH-01 §9.
export function MonthlyContent({ api, data, args, today, back }) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const block = useStats(api, { ...args, month_offset: offset }, offset > 0);
  const source = offset > 0 ? block.data : data;
  const currency = data.filters.currency;
  const navigation = (current) => (offset > 0 || current.month_next_offset !== null) && (
    <div className="block-nav">
      <button type="button" className="btn ghost" disabled={offset === 0 || block.isFetching}
        onClick={() => { setSelected(null); setOffset(Math.max(0, offset - 60)); }}><Icon name="back" />Meses anteriores</button>
      <span className="small-data">{monthShort(current.months[0].month, true)} – {monthShort(current.months.at(-1).month, true)}</span>
      <button type="button" className="btn ghost" disabled={current.month_next_offset === null || block.isFetching}
        onClick={() => { setSelected(null); setOffset(current.month_next_offset); }}>Meses siguientes<Icon name="forward" /></button>
    </div>
  );
  if (offset > 0 && !block.data) return <PanelBody query={block} height={240}>{null}</PanelBody>;
  const months = source.months;
  const multiYear = months[0].month.slice(0, 4) !== months.at(-1).month.slice(0, 4);
  const rows = months.map((month) => ({ ...month, key: month.month, label: monthShort(month.month, multiYear), value: chartNumber(month.total) }));
  const current = rows.find((row) => row.from <= today && today <= row.to)?.key;
  const chosen = rows.find((row) => row.key === selected);
  const describe = (row) => <>
    <strong>{monthLong(row.month)}{row.key === current ? ' · parcial' : ''}</strong>
    <span>{row.total === null ? 'Sin registros' : `${currency} ${money(row.total)}`}</span>
    <span>{row.count ? expensesCount(row.count) : `Moneda ${currency}`}</span>
  </>;
  return (
    <div onKeyDown={(event) => { if (event.key === 'Escape' && chosen) { event.stopPropagation(); setSelected(null); } }}>
      {navigation(source)}
      <Suspense fallback={<div className="panel-skeleton" style={{ minHeight: 200 }} />}>
        <MonthlyChart rows={rows} highlighted={selected ?? current} render={describe} onSelect={setSelected}
          label={`Gráfico de barras del gasto mensual en ${currency}. Flechas para recorrer los meses, Enter para ver el detalle.`} />
      </Suspense>
      <div className="chart-foot"><span className="key">Gasto mensual · {currency}</span><span>{months.length} {months.length === 1 ? 'mes' : 'meses'}</span></div>
      {chosen && <div className="chart-detail" role="region" aria-label={`Detalle de ${monthLong(chosen.month)}`}>
        <div className="chart-detail-text">{describe(chosen)}</div>
        <div className="chart-detail-actions">
          {chosen.count > 0 && <HistoryLink filters={periodFilters(data.filters, chosen)} back={back}>
            Ver gastos de {monthLong(chosen.month).replace(' de ', ' ')}<Icon name="up" /></HistoryLink>}
          <button type="button" className="btn ghost" onClick={() => setSelected(null)}>Cerrar</button>
        </div>
      </div>}
      <ChartTable caption={`Gasto por mes en ${currency}. Cada mes con gastos abre el Historial.`} headers={['Mes', 'Gastos', currency]} numeric={[1, 2]}
        rows={rows.map((row) => {
          const label = monthLong(row.month).replace(' de ', ' ') + (row.key === current ? ' · parcial' : '');
          return { key: row.key, cells: [
            row.count > 0 ? <HistoryLink filters={periodFilters(data.filters, row)} back={back} label={`Ver los gastos de ${label}`}>{label}</HistoryLink> : label,
            count(row.count), row.total === null ? 'Sin registros' : money(row.total),
          ] };
        })} />
    </div>
  );
}

export function CategoryRow({ name, archived, total, share, count: amount, currency, children }) {
  return <>
    <span className="cat-name">{name}{archived && <small className="archived-mark">Archivada</small>}<small className="muted-text"> · {count(amount)}</small></span>
    <span className="cat-amount"><span className="money">{money(total)}</span><small className="muted-text"> · {percentage(share)}</small>
      <span className="sr-only"> {currency}, {expensesCount(amount)}</span></span>
    <span className="track" aria-hidden="true"><span className="fill" style={{ width: Math.max(Number(share), 0.5) + '%' }} /></span>
    {children}
  </>;
}

// ── Gastos por categoría y desglose por subcategoría (RF-018).
export function CategoriesContent({ api, data, query, catalog, back, onBreakdown }) {
  const currency = data.filters.currency;
  const scoped = Boolean(data.filters.category_id);
  const parentId = data.filters.category_id ?? (query.breakdown || null);
  const detail = useStats(api, breakdownArgs(query, currency), !scoped && Boolean(query.breakdown));
  const archivedParent = (id) => catalog?.categories.find((row) => row.id === id)?.archived;
  const archivedChild = (id, parent) => Boolean(id && (catalog?.subcategories.find((row) => row.id === id)?.archived || archivedParent(parent)));

  if (parentId) {
    const view = scoped ? { data, isError: false, isFetching: false } : detail;
    const name = catalog?.categories.find((row) => row.id === parentId)?.name ?? view.data?.categories[0]?.name ?? 'Categoría';
    const filters = view.data?.filters;
    return (
      <div className="breakdown">
        {!scoped && <button type="button" className="btn ghost breakdown-back" onClick={() => onBreakdown('')}><Icon name="back" />Todas las categorías</button>}
        <PanelBody query={view} height={180}>
          {view.data && <>
            <div className="breakdown-head">
              <h3>{name}{archivedParent(parentId) && <small className="archived-mark">Archivada</small>}</h3>
              {view.data.indicator.current.count > 0
                ? <p><span className="money">{currency} {money(view.data.indicator.current.total)}</span> · {expensesCount(view.data.indicator.current.count)}
                  {' '}<HistoryLink filters={filters} back={back}>Ver gastos de {name}<Icon name="up" /></HistoryLink></p>
                : <p className="muted-text">Sin registros en {currency} en este período.</p>}
            </div>
            {view.data.indicator.current.count > 0 && (
              <>
                <CategoryDonut
                  categories={view.data.children.map((child) => ({
                    ...child,
                    id: child.id ?? '__none__',
                    rawId: child.id,
                    name: child.id === null ? 'Sin subcategoría' : child.name,
                  }))}
                  total={view.data.indicator.current.total}
                  totalCount={view.data.indicator.current.count}
                  currency={currency}
                  filters={filters}
                  eyebrow={`Subcategorías · ${currency} · % de ${name}`}
                  centerEyebrow={name}
                  shareSuffix={`de ${name}`}
                  legendLabel={`Subcategorías de ${name}`}
                  back={back}
                  isArchived={(id) => archivedChild(id === '__none__' ? null : id, parentId)}
                  getHistoryFilters={(slice) => childFilters(filters, parentId, slice.rawId)}
                  showOtherBreakdown
                />
                <ChartTable
                  caption={`Gasto por subcategoría de ${name} en ${currency}. Cada subcategoría abre el Historial.`}
                  headers={['Subcategoría', 'Gastos', currency, '%']}
                  numeric={[1, 2, 3]}
                  rows={view.data.children.map((child) => {
                    const label = child.id === null ? 'Sin subcategoría' : child.name;
                    const archived = archivedChild(child.id, parentId);
                    return {
                      key: child.id ?? 'none',
                      cells: [
                        <HistoryLink
                          key="link"
                          filters={childFilters(filters, parentId, child.id)}
                          back={back}
                          label={`Ver los gastos de ${label}${archived ? ' · Archivada' : ''}`}
                        >
                          {label + (archived ? ' · Archivada' : '')}
                        </HistoryLink>,
                        count(child.count),
                        money(child.total),
                        percentage(child.share),
                      ],
                    };
                  })}
                />
              </>
            )}
          </>}
        </PanelBody>
      </div>
    );
  }

  if (!data.categories.length) return <p className="panel-empty">Sin registros en {currency} en este período.</p>;
  const copy = donutPeriodCopy(query, currency);
  return <>
    <CategoryDonut
      categories={data.categories}
      total={data.indicator.current.total}
      totalCount={data.indicator.current.count}
      currency={currency}
      filters={data.filters}
      eyebrow={copy.eyebrow}
      centerEyebrow={copy.centerEyebrow}
      shareSuffix={copy.shareSuffix}
      legendLabel={copy.legendLabel}
      back={back}
      isArchived={archivedParent}
      onBreakdown={onBreakdown}
      showOtherBreakdown
    />
    <ChartTable caption={`Gasto por categoría en ${currency}. Cada categoría abre el Historial.`} headers={['Categoría', 'Gastos', currency, '%']} numeric={[1, 2, 3]}
      rows={data.categories.map((category) => ({ key: category.id, cells: [
        <HistoryLink key="link" filters={categoryFilters(data.filters, category.id)} back={back}
          label={`Ver los gastos de ${category.name}${archivedParent(category.id) ? ' · Archivada' : ''}`}>
          {category.name + (archivedParent(category.id) ? ' · Archivada' : '')}</HistoryLink>,
        count(category.count), money(category.total), percentage(category.share),
      ] }))} />
  </>;
}

// ── Comparación por categoría (RF-018), con categorías presentes en un solo período.
export function ComparisonContent({ data, today, back }) {
  const currency = data.filters.currency;
  if (!data.reference) return <p className="panel-empty">Este período no tiene un período de referencia anterior.</p>;
  if (!data.category_comparisons.length) return <p className="panel-empty">Sin registros en {currency} en ninguno de los dos períodos.</p>;
  const cell = (metric, range, row, side) => metric.count
    ? <HistoryLink filters={{ ...periodFilters(data.filters, range), category_id: row.id }} back={back}
      label={`${row.name}, ${side}: ${currency} ${money(metric.total)}. Ver ${expensesCount(metric.count)}`}>{money(metric.total)}</HistoryLink>
    : <span className="muted-text">Sin registros</span>;
  // Sin base: la referencia no tiene gastos. No disponible: el período actual no tiene gastos.
  const variation = (row) => row.percent !== null ? percentage(row.percent, { sign: true })
    : row.reference.count === 0 ? 'Sin base' : row.current.count === 0 ? 'No disponible' : 'No comparable';
  return <>
    <p className="period-line compare-periods">
      <span><b>Actual</b> · {rangeDays(data.filters)}{isPartial(data.filters, today) && ' · parcial'}</span>
      <span><b>Referencia</b> · {rangeDays(data.reference)}</span>
      <span>{currency}</span>
    </p>
    <table className="compare">
      <thead><tr><th scope="col">Categoría</th><th scope="col" className="right">Actual</th><th scope="col" className="right">Referencia</th>
        <th scope="col" className="right">Diferencia</th><th scope="col" className="right">Variación</th></tr></thead>
      <tbody>
        {data.category_comparisons.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.name}</th>
            <td data-label="Actual" className="right">{cell(row.current, data.filters, row, 'actual')}</td>
            <td data-label="Referencia" className="right">{cell(row.reference, data.reference, row, 'referencia')}</td>
            <td data-label="Diferencia" className="right">{row.delta === null ? <span className="muted-text">—<span className="sr-only">No disponible</span></span> : signedMoney(row.delta)}</td>
            <td data-label="Variación" className="right">{row.percent === null ? <span className="muted-text">{variation(row)}</span> : variation(row)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {data.comparable === false && <p className="panel-note">Variación porcentual no comparable: {variationNote(data, today).toLowerCase()}.</p>}
  </>;
}

// ── Resumen inteligente (RF-023).
export function SummaryContent({ data, today }) {
  const { headline, lines } = describeStats(data, today);
  return (
    <div className="summary">
      {headline && <p className="summary-headline">{headline.before}<strong>{headline.strong}</strong>{headline.after}</p>}
      <div className={headline ? 'summary-lines' : 'summary-lines alone'}>{lines.map((line) => <p key={line}>{line}</p>)}</div>
    </div>
  );
}
