import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon.jsx';
import { chartNumber, count, expensesCount, money, percentage, signedMoney } from './format.js';
import { historyHref, yearFilters } from './links.js';
import { ChartTable, PanelBody } from './panels.jsx';

const AnnualChart = lazy(() => import('./charts.jsx').then((module) => ({ default: module.AnnualChart })));

// Controles de la ventana anual (RF-020): su propio bloque de cinco años, independiente
// del período general. Usan los límites que devuelve el servidor.
export function AnnualTools({ query, data, onWindow }) {
  const start = data?.start_year;
  const end = data?.end_year;
  return (
    <div className="year-nav">
      <button type="button" className="square" disabled={!data || data.previous_end_year === null}
        aria-label={data?.previous_end_year ? `Años anteriores: ${Math.max(1, data.previous_end_year - 4)} a ${data.previous_end_year}` : 'Años anteriores'}
        onClick={() => onWindow(data.previous_end_year)}><Icon name="back" /></button>
      <span className="small-data" aria-live="polite">{data ? `${start} – ${end}` : query.annualEnd ? `… – ${query.annualEnd}` : '…'}</span>
      <button type="button" className="square" disabled={!data || data.next_end_year === null}
        aria-label={data?.next_end_year ? `Años más recientes: hasta ${data.next_end_year}` : 'Años más recientes'}
        onClick={() => onWindow(data.next_end_year)}><Icon name="forward" /></button>
    </div>
  );
}

// En la tabla: importe y porcentaje en dos bloques que solo se separan entre sí.
function tableVariation(point) {
  if (point.total === null) return '—';
  if (point.partial) return 'Parcial';
  if (point.delta === null) return 'Sin base';
  return <><span className="nowrap">{signedMoney(point.delta)}</span> <span className="nowrap">({percentage(point.percent, { sign: true })})</span></>;
}

function variation(point) {
  if (point.partial) return 'Año parcial: sin variación';
  if (point.delta === null) return point.count ? 'Sin año anterior comparable' : '—';
  return `${signedMoney(point.delta)} (${percentage(point.percent, { sign: true })})`;
}

export function AnnualContent({ back, data }) {
  const [selected, setSelected] = useState(null);
  const currency = data.currency;
  const label = data.label ?? 'Todas las categorías';
  const rows = data.points.map((point) => ({ ...point, key: String(point.year), value: chartNumber(point.total) }));
  const chosen = rows.find((row) => row.key === selected);
  const empty = rows.filter((row) => row.count === 0).map((row) => row.year);
  const partial = rows.find((row) => row.partial);
  const describe = (row) => <>
    <strong>{row.year}{row.partial ? ' · parcial' : ''}</strong>
    <span>{label} · {currency}</span>
    <span>{row.total === null ? 'Sin registros' : `${currency} ${money(row.total)} · ${expensesCount(row.count)}`}</span>
    {row.total !== null && !row.partial && row.delta !== null && <span>vs. {row.year - 1}: {variation(row)}</span>}
  </>;
  return (
    <div onKeyDown={(event) => { if (event.key === 'Escape' && chosen) { event.stopPropagation(); setSelected(null); } }}>
      <div className="annual-meta">
        <span className="small-data">{label} · {currency}</span>
        {partial && <span className="tag">{partial.year} parcial</span>}
      </div>
      <div className="annual-chart">
        <Suspense fallback={<div className="panel-skeleton" style={{ minHeight: 200 }} />}>
          <AnnualChart rows={rows} selected={selected} render={describe} onSelect={setSelected}
            label={`Gráfico de líneas del gasto anual de ${label} en ${currency}, de ${data.start_year} a ${data.end_year}. Flechas para recorrer los años, Enter para ver el detalle.`} />
        </Suspense>
        {empty.length === rows.length && <p className="chart-overlay">Sin registros en {currency} entre {data.start_year} y {data.end_year}.</p>}
      </div>
      <div className="chart-foot">
        <span className="key">Gasto registrado · {currency}</span>
        <span>{empty.length > 0 && empty.length < rows.length ? `${empty.join(', ')} · Sin registros` : ''}</span>
      </div>
      {chosen && <div className="chart-detail" role="region" aria-label={`Detalle de ${chosen.year}`}>
        <div className="chart-detail-text">{describe(chosen)}</div>
        <div className="chart-detail-actions">
          {chosen.count > 0 && <Link className="history-link" to={historyHref(yearFilters(data, chosen.year), back)}>
            Ver gastos de {chosen.year}<Icon name="up" /></Link>}
          <button type="button" className="btn ghost" onClick={() => setSelected(null)}>Cerrar</button>
        </div>
      </div>}
      <ChartTable caption={`Gasto anual de ${label} en ${currency}. Cada año con gastos abre el Historial.`} headers={['Año', 'Gastos', currency, 'Variación']} numeric={[1, 2]}
        rows={rows.map((row) => {
          const year = row.year + (row.partial ? ' · parcial' : '');
          return { key: row.key, cells: [
            row.count > 0 ? <Link className="history-link" to={historyHref(yearFilters(data, row.year), back)}
              aria-label={`Ver los gastos de ${year}`}>{year}</Link> : year,
            count(row.count), row.total === null ? 'Sin registros' : money(row.total), tableVariation(row),
          ] };
        })} />
    </div>
  );
}

export function AnnualPanelBody({ annual, back, onClear }) {
  return <PanelBody query={annual} height={260} onClear={onClear}>{annual.data && <AnnualContent data={annual.data} back={back} />}</PanelBody>;
}
