import { useId, useMemo, useRef, useState } from 'react';
import { SpringSelect } from '../../components/SpringSelect.jsx';
import { compactAxis, expensesCount, figureSize, money, percentage, signedMoney } from './format.js';
import {
  buildCumulativeMonthly,
  daysInMonth,
  parseMonthKey,
  recentMonthOptions,
  shiftMonthKey,
} from './insights.js';
import { ChartTable, PanelBody } from './panels.jsx';
import { useExpensesWindow } from './stats.js';

const W = 620;
const H = 246;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 20;
const PAD_B = 30;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

const pad2 = (value) => String(value).padStart(2, '0');

function niceMax(value) {
  if (!(value > 0)) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  // Múltiplos limpios divisibles entre 4 para ticks enteros en el eje Y (0, 25 %, 50 %, 75 %, 100 %).
  const ceil = scaled <= 1.2 ? 1.2 : scaled <= 1.6 ? 1.6 : scaled <= 2 ? 2
    : scaled <= 2.4 ? 2.4 : scaled <= 2.8 ? 2.8 : scaled <= 3.2 ? 3.2
    : scaled <= 4 ? 4 : scaled <= 4.8 ? 4.8 : scaled <= 6 ? 6 : scaled <= 8 ? 8 : 10;
  return ceil * magnitude;
}

function buildLinePath(points, valueKey, xForDay, yForValue) {
  const segments = [];
  for (const point of points) {
    const val = point[valueKey];
    if (val === null) continue;
    const x = xForDay(point.day).toFixed(2);
    const y = yForValue(val).toFixed(2);
    segments.push(`${segments.length === 0 ? 'M' : 'L'}${x} ${y}`);
  }
  return segments.join(' ');
}

function buildAreaPath(points, valueKey, xForDay, yForValue, baseY) {
  const valid = points.filter((point) => point[valueKey] !== null);
  if (valid.length < 2) return '';
  const line = buildLinePath(valid, valueKey, xForDay, yForValue);
  const lastX = xForDay(valid.at(-1).day).toFixed(2);
  const firstX = xForDay(valid[0].day).toFixed(2);
  return `${line} L${lastX} ${baseY.toFixed(2)} L${firstX} ${baseY.toFixed(2)} Z`;
}

function CumulativeSvgChart({ series, activeDay, onActiveDay }) {
  const gradId = 'cm' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const svgRef = useRef(null);

  const yMax = niceMax(series.maxValueNum);
  const xForDay = (day) => PAD_L + ((day - 1) / Math.max(1, series.maxDays - 1)) * PLOT_W;
  const yForValue = (value) => PAD_T + PLOT_H - (Math.max(0, value) / yMax) * PLOT_H;
  const baseY = PAD_T + PLOT_H;

  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];
  const xTicks = useMemo(() => {
    const base = [1, 5, 10, 15, 20, 25];
    if (series.maxDays > 26) base.push(series.maxDays);
    return base.filter((day) => day <= series.maxDays);
  }, [series.maxDays]);

  const { pathA, areaA, pathB } = useMemo(() => {
    const xFn = (day) => PAD_L + ((day - 1) / Math.max(1, series.maxDays - 1)) * PLOT_W;
    const yFn = (value) => PAD_T + PLOT_H - (Math.max(0, value) / yMax) * PLOT_H;
    return {
      pathA: buildLinePath(series.points, 'cumANum', xFn, yFn),
      areaA: buildAreaPath(series.points, 'cumANum', xFn, yFn, PAD_T + PLOT_H),
      pathB: buildLinePath(series.points, 'cumBNum', xFn, yFn),
    };
  }, [series.points, series.maxDays, yMax]);

  const cutPointA = series.points[series.lastDayA - 1];
  const cutPointB = series.points[series.compareDayB - 1];
  const activePoint = activeDay ? series.points[activeDay - 1] : null;

  function pickDayFromEvent(event) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const relX = ((event.clientX - rect.left) / rect.width) * W;
    const clamped = Math.max(PAD_L, Math.min(W - PAD_R, relX));
    const ratio = (clamped - PAD_L) / PLOT_W;
    const day = Math.max(1, Math.min(series.maxDays, Math.round(ratio * (series.maxDays - 1)) + 1));
    onActiveDay(day);
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onActiveDay(activeDay ? Math.min(series.maxDays, activeDay + 1) : 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onActiveDay(activeDay ? Math.max(1, activeDay - 1) : series.lastDayA);
    } else if (event.key === 'Escape' && activeDay) {
      event.preventDefault();
      onActiveDay(null);
    }
  }

  // Posición segura del tooltip para evitar desbordes a izquierda o derecha en celular.
  const tipPercent = activePoint ? ((xForDay(activePoint.day) - PAD_L) / PLOT_W) * 100 : 50;
  const tipAlign = tipPercent < 28 ? 'start' : tipPercent > 72 ? 'end' : 'center';

  return (
    <div
      className="cm-chart-wrap"
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') onActiveDay(null);
      }}
    >
      <svg
        ref={svgRef}
        className="cm-svg"
        viewBox={`0 0 ${W} ${H}`}
        tabIndex={0}
        role="img"
        aria-label={`Evolución acumulada día a día en ${series.currency}: ${series.labelA} hasta el día ${series.lastDayA} (${money(series.current.total)}) frente a ${series.labelB} al día ${series.compareDayB} (${money(series.refAtSameDay.total)}). Usá las flechas izquierda y derecha para recorrer los días.`}
        onKeyDown={handleKeyDown}
        onBlur={() => onActiveDay(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ecebe2" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#ecebe2" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Líneas guía horizontales y eje Y */}
        {yTicks.map((val, index) => {
          const y = yForValue(val);
          return (
            <g key={index}>
              <line
                x1={PAD_L}
                y1={y.toFixed(2)}
                x2={W - PAD_R}
                y2={y.toFixed(2)}
                stroke={index === 0 ? '#353739' : '#2b2d2e'}
                strokeWidth="1"
              />
              <text x={PAD_L - 8} y={y + 4} textAnchor="end" className="cm-axis-text">
                {compactAxis(val)}
              </text>
            </g>
          );
        })}

        {/* Etiquetas del eje X (días) */}
        {xTicks.map((day) => (
          <text key={day} x={xForDay(day).toFixed(2)} y={H - 8} textAnchor="middle" className="cm-axis-text">
            {day}
          </text>
        ))}

        {/* Marca vertical del día actual (corte comparable) */}
        {series.isCurrentA && (
          <g className="cm-cut-guide">
            <line
              x1={xForDay(series.lastDayA).toFixed(2)}
              y1={PAD_T}
              x2={xForDay(series.lastDayA).toFixed(2)}
              y2={baseY}
              stroke="#484b4d"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <text
              x={xForDay(series.lastDayA).toFixed(2)}
              y={PAD_T - 5}
              textAnchor={series.lastDayA > series.maxDays - 3 ? 'end' : series.lastDayA < 3 ? 'start' : 'middle'}
              className="cm-cut-label"
            >
              Día {series.lastDayA}
            </text>
          </g>
        )}

        {/* Área suave bajo el mes actual */}
        {areaA && <path d={areaA} fill={`url(#${gradId})`} />}

        {/* Línea 2: mes de referencia (mes completo, trazo punteado) */}
        {pathB && (
          <path
            d={pathB}
            fill="none"
            stroke="#82888a"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Línea 1: mes actual (trazo continuo hasta hoy) */}
        {pathA && (
          <path
            d={pathA}
            fill="none"
            stroke="#ecebe2"
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Punto de referencia al mismo día */}
        {cutPointB?.cumBNum !== null && (
          <circle
            cx={xForDay(cutPointB.day).toFixed(2)}
            cy={yForValue(cutPointB.cumBNum).toFixed(2)}
            r="4"
            fill="#171819"
            stroke="#989e9d"
            strokeWidth="2"
          />
        )}

        {/* Punto final del mes actual */}
        {cutPointA?.cumANum !== null && (
          <g>
            <circle
              cx={xForDay(cutPointA.day).toFixed(2)}
              cy={yForValue(cutPointA.cumANum).toFixed(2)}
              r="9"
              fill="#ecebe2"
              opacity="0.14"
            />
            <circle
              cx={xForDay(cutPointA.day).toFixed(2)}
              cy={yForValue(cutPointA.cumANum).toFixed(2)}
              r="4.5"
              fill="#ecebe2"
              stroke="#171819"
              strokeWidth="1.8"
            />
          </g>
        )}

        {/* Cursor interactivo y puntos activos del día inspeccionado */}
        {activePoint && (
          <g className="cm-cursor" pointerEvents="none">
            <line
              x1={xForDay(activePoint.day).toFixed(2)}
              y1={PAD_T}
              x2={xForDay(activePoint.day).toFixed(2)}
              y2={baseY}
              stroke="#727679"
              strokeWidth="1"
            />
            {activePoint.cumBNum !== null && (
              <circle
                cx={xForDay(activePoint.day).toFixed(2)}
                cy={yForValue(activePoint.cumBNum).toFixed(2)}
                r="4.5"
                fill="#171819"
                stroke="#b9babb"
                strokeWidth="2"
              />
            )}
            {activePoint.cumANum !== null && (
              <circle
                cx={xForDay(activePoint.day).toFixed(2)}
                cy={yForValue(activePoint.cumANum).toFixed(2)}
                r="5.2"
                fill="#f4f2eb"
                stroke="#171819"
                strokeWidth="2"
              />
            )}
          </g>
        )}

        {/* Superficie de interacción táctil y puntero sobre toda el área del gráfico */}
        <rect
          x={PAD_L}
          y={PAD_T}
          width={PLOT_W}
          height={PLOT_H}
          fill="transparent"
          className="cm-hit-area"
          onPointerDown={(event) => {
            if (event.button !== 0 && event.pointerType === 'mouse') return;
            pickDayFromEvent(event);
          }}
          onPointerMove={(event) => {
            if (event.pointerType === 'mouse' || event.buttons > 0) {
              pickDayFromEvent(event);
            }
          }}
        />
      </svg>

      {activePoint && (
        <div
          className={`chart-tip cm-tip cm-tip--${tipAlign}`}
          style={{ left: `${Math.max(4, Math.min(96, tipPercent))}%` }}
          role="status"
          aria-live="polite"
        >
          <strong>Día {activePoint.day}</strong>
          <div className="cm-tip-row">
            <span className="cm-line-dot cm-line-dot--a" aria-hidden="true" />
            <span>
              {series.shortA}:{' '}
              {activePoint.cumAText !== null ? (
                <>
                  <b>{series.currency} {money(activePoint.cumAText)}</b>
                  {activePoint.dailyACents > 0n && (
                    <small> (+{money(activePoint.dailyAText)} ese día)</small>
                  )}
                </>
              ) : (
                <small>{activePoint.dateA ? 'Día aún no transcurrido' : `Sin día ${activePoint.day}`}</small>
              )}
            </span>
          </div>
          <div className="cm-tip-row">
            <span className="cm-line-dot cm-line-dot--b" aria-hidden="true" />
            <span>
              {series.shortB}:{' '}
              {activePoint.cumBText !== null ? (
                <>
                  <b>{series.currency} {money(activePoint.cumBText)}</b>
                  {activePoint.dailyBCents > 0n && (
                    <small> (+{money(activePoint.dailyBText)} ese día)</small>
                  )}
                </>
              ) : (
                <small>Sin día {activePoint.day} en {series.shortB.toLowerCase()}</small>
              )}
            </span>
          </div>
          {activePoint.deltaText !== null && (
            <div className="cm-tip-delta">
              Diferencia:{' '}
              <span className={activePoint.deltaCents > 0n ? 'pc-delta--up' : activePoint.deltaCents < 0n ? 'pc-delta--down' : ''}>
                {signedMoney(activePoint.deltaText)} {series.currency}
                {activePoint.percentText !== null && ` (${percentage(activePoint.percentText, { sign: true })})`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CumulativeMonthlyCard({ api, today, currency, catalog, defaultTwoMonthQuery }) {
  const id = useId();
  const currentMonth = today.slice(0, 7);
  const prevMonth = shiftMonthKey(currentMonth, -1) ?? currentMonth;

  const [compareMonth, setCompareMonth] = useState(prevMonth);
  const [categoryId, setCategoryId] = useState('');
  const [activeDay, setActiveDay] = useState(null);

  const compareMonthOptions = useMemo(
    () => recentMonthOptions(today, 36).filter((option) => option.value !== currentMonth),
    [today, currentMonth],
  );

  const categoryOptions = useMemo(() => [
    { value: '', label: 'Todas las categorías' },
    ...(catalog?.categories ?? []).map((row) => ({
      value: row.id,
      label: row.name + (row.archived ? ' · Archivada' : ''),
    })),
  ], [catalog]);

  const isDefaultCompare = compareMonth === prevMonth;
  const compareWindowArgs = useMemo(() => {
    const { year, month } = parseMonthKey(compareMonth);
    const last = daysInMonth(year, month);
    return { from: `${compareMonth}-01`, to: `${compareMonth}-${pad2(last)}`, currency };
  }, [compareMonth, currency]);

  const extraMonthQuery = useExpensesWindow(api, compareWindowArgs, !isDefaultCompare);

  const combinedQuery = useMemo(() => {
    const isError = defaultTwoMonthQuery.isError || (!isDefaultCompare && extraMonthQuery.isError);
    const error = defaultTwoMonthQuery.error ?? (!isDefaultCompare ? extraMonthQuery.error : null);
    const ready = Boolean(defaultTwoMonthQuery.data && (isDefaultCompare || extraMonthQuery.data));
    const isFetching = defaultTwoMonthQuery.isFetching || (!isDefaultCompare && extraMonthQuery.isFetching);
    return {
      isError,
      error,
      isFetching,
      data: ready ? { a: defaultTwoMonthQuery.data, b: isDefaultCompare ? defaultTwoMonthQuery.data : extraMonthQuery.data } : null,
      refetch: () => {
        void defaultTwoMonthQuery.refetch();
        if (!isDefaultCompare) void extraMonthQuery.refetch();
      },
    };
  }, [defaultTwoMonthQuery, extraMonthQuery, isDefaultCompare]);

  const series = useMemo(() => {
    if (!combinedQuery.data) return null;
    return buildCumulativeMonthly({
      expensesA: combinedQuery.data.a,
      expensesB: combinedQuery.data.b,
      monthA: currentMonth,
      monthB: compareMonth,
      today,
      currency,
      categoryId,
    });
  }, [combinedQuery.data, currentMonth, compareMonth, today, currency, categoryId]);

  const deltaTone = !series ? 'same' : series.deltaCents > 0n ? 'up' : series.deltaCents < 0n ? 'down' : 'same';

  const tableRows = useMemo(() => {
    if (!series) return [];
    // Mostrar los días clave (días con gastos en alguno de los dos meses + el corte actual + el cierre del mes comparado).
    return series.points
      .filter((point) =>
        point.dailyACents > 0n
        || point.dailyBCents > 0n
        || point.day === series.lastDayA
        || point.day === series.daysB)
      .map((point) => ({
        key: String(point.day),
        cells: [
          `Día ${point.day}${point.day === series.lastDayA && series.isCurrentA ? ' · hoy' : ''}`,
          point.cumAText !== null ? money(point.cumAText) : '—',
          point.cumBText !== null ? money(point.cumBText) : '—',
          point.deltaText !== null ? signedMoney(point.deltaText) : '—',
        ],
      }));
  }, [series]);

  return (
    <section
      className="panel pad stats-panel span-2"
      aria-labelledby="card-cumulative-monthly"
      aria-busy={combinedQuery.isFetching}
      data-card="cumulative-monthly"
    >
      <div className="panel-title cm-head">
        <div>
          <h2 id="card-cumulative-monthly">Evolución acumulada del mes</h2>
          <p className="card-subtitle">Ritmo diario acumulado dentro del mes frente a un mes de referencia · {currency}</p>
        </div>
        <div className="cm-controls">
          <div className="field cm-control-field">
            <label htmlFor={`${id}-cmp`}>Comparar con</label>
            <SpringSelect
              id={`${id}-cmp`}
              value={compareMonth}
              options={compareMonthOptions}
              onChange={(next) => { setActiveDay(null); setCompareMonth(next); }}
            />
          </div>
          <div className="field cm-control-field">
            <label htmlFor={`${id}-cat`}>Categoría</label>
            <SpringSelect
              id={`${id}-cat`}
              value={categoryId}
              disabled={!catalog}
              options={categoryOptions}
              onChange={(next) => { setActiveDay(null); setCategoryId(next); }}
            />
          </div>
        </div>
      </div>

      <PanelBody query={combinedQuery} height={240} loading="Cargando evolución acumulada del mes…">
        {series && (
          <>
            <dl className="metrics cm-summary">
              <div>
                <dt className="eyebrow">{series.labelA} · al día {series.lastDayA}</dt>
                <dd className="figure" data-size={figureSize(money(series.current.total))}>
                  {money(series.current.total)} <span className="unit">{currency}</span>
                </dd>
                <dd className="metric-note">{expensesCount(series.current.count)}</dd>
              </div>

              <div>
                <dt className="eyebrow">
                  {series.labelB} · al día {series.compareDayB}
                </dt>
                <dd className="figure" data-size={figureSize(money(series.refAtSameDay.total))}>
                  {money(series.refAtSameDay.total)} <span className="unit">{currency}</span>
                </dd>
                <dd className="metric-note">
                  Mes completo: {money(series.refFullMonth.total)} {currency}
                  {series.clampedB ? ` · fin de ${series.shortB.toLowerCase()}` : ''}
                </dd>
              </div>

              <div>
                <dt className="eyebrow">Diferencia al mismo día</dt>
                <dd
                  className={`figure pc-delta pc-delta--${deltaTone}`}
                  data-size={figureSize(signedMoney(series.deltaText))}
                >
                  {signedMoney(series.deltaText)} <span className="unit">{currency}</span>
                </dd>
                <dd className="metric-note">
                  {series.percentText !== null ? (
                    <span className={`pc-pct pc-delta--${deltaTone}`}>
                      {percentage(series.percentText, { sign: true })}
                    </span>
                  ) : series.current.count === 0 && series.refAtSameDay.count === 0 ? (
                    'Sin gastos hasta este día'
                  ) : (
                    `Sin base al día ${series.compareDayB}`
                  )}
                </dd>
              </div>
            </dl>

            {!series.hasAnyData ? (
              <p className="panel-empty cm-empty">
                Sin gastos registrados en {currency} entre {series.labelA} y {series.labelB}
                {categoryId ? ' para esta categoría' : ''}.
              </p>
            ) : (
              <>
                <CumulativeSvgChart series={series} activeDay={activeDay} onActiveDay={setActiveDay} />

                <div className="chart-foot cm-foot">
                  <div className="cm-legend">
                    <span className="cm-legend-item">
                      <span className="cm-swatch-line cm-swatch-line--a" aria-hidden="true" />
                      {series.labelA} (hasta día {series.lastDayA})
                    </span>
                    <span className="cm-legend-item">
                      <span className="cm-swatch-line cm-swatch-line--b" aria-hidden="true" />
                      {series.labelB} (mes completo)
                    </span>
                  </div>
                  <span>Acumulado diario · {currency}</span>
                </div>

                {tableRows.length > 0 && (
                  <ChartTable
                    caption={`Acumulado diario de ${series.labelA} frente a ${series.labelB} en ${currency}.`}
                    headers={['Día', series.shortA, series.shortB, 'Diferencia']}
                    numeric={[1, 2, 3]}
                    rows={tableRows}
                  />
                )}
              </>
            )}
          </>
        )}
      </PanelBody>
    </section>
  );
}
