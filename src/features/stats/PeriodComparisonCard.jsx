import { useId, useMemo, useState } from 'react';
import { IsoDatePicker } from '../../components/DatePicker.jsx';
import { SpringSelect } from '../../components/SpringSelect.jsx';
import { validDate } from '../expenses/draft.js';
import { expensesCount, figureSize, money, percentage, signedMoney } from './format.js';
import {
  buildPeriodComparisonFromExpenses,
  buildPeriodComparisonFromStats,
  daysInMonth,
  parseMonthKey,
  recentMonthOptions,
  recentYearOptions,
  resolveAnnualComparison,
  resolveCustomComparison,
  resolveMonthlyComparison,
  shiftMonthKey,
} from './insights.js';
import { HistoryLink, PanelBody } from './panels.jsx';
import { useStats } from './stats.js';

const INITIAL_CATEGORIES = 6;
const pad2 = (value) => String(value).padStart(2, '0');

function defaultCustomRanges(today) {
  const currentMonth = today.slice(0, 7);
  const prevMonth = shiftMonthKey(currentMonth, -1) ?? currentMonth;
  const day = Number(today.slice(8, 10));
  const { year: prevY, month: prevM } = parseMonthKey(prevMonth);
  const prevDay = Math.min(day, daysInMonth(prevY, prevM));
  return {
    a: { from: `${currentMonth}-01`, to: today },
    b: { from: `${prevMonth}-01`, to: `${prevMonth}-${pad2(prevDay)}` },
  };
}

function deltaTone(deltaCents) {
  if (deltaCents > 0n) return 'up';
  if (deltaCents < 0n) return 'down';
  return 'same';
}

function categoryDeltaBadge(row) {
  if (row.status === 'new') return 'Nueva';
  if (row.status === 'gone') return 'Sin gasto en A';
  if (row.percentText === null) return 'Sin base';
  return percentage(row.percentText, { sign: true });
}

function barPercent(valueCents, maxCents) {
  if (maxCents <= 0n || valueCents <= 0n) return 0;
  const pct = (Number(valueCents) / Number(maxCents)) * 100;
  return Math.max(2, Math.min(100, pct));
}

export function PeriodComparisonCard({ api, today, currency, back, defaultTwoMonthQuery }) {
  const id = useId();
  const currentMonth = today.slice(0, 7);
  const prevMonth = shiftMonthKey(currentMonth, -1) ?? currentMonth;
  const currentYear = Number(today.slice(0, 4));
  const prevYear = Math.max(1, currentYear - 1);

  const [mode, setMode] = useState('monthly'); // 'monthly' | 'annual' | 'custom'
  const [monthA, setMonthA] = useState(currentMonth);
  const [monthB, setMonthB] = useState(prevMonth);
  const [yearA, setYearA] = useState(String(currentYear));
  const [yearB, setYearB] = useState(String(prevYear));
  const [custom, setCustom] = useState(() => defaultCustomRanges(today));
  const [showAll, setShowAll] = useState(false);

  const monthOptions = useMemo(() => recentMonthOptions(today, 36), [today]);
  const yearOptions = useMemo(() => recentYearOptions(today, 10), [today]);

  const customError = useMemo(() => {
    if (mode !== 'custom') return '';
    const { a, b } = custom;
    if (!validDate(a.from) || !validDate(a.to) || !validDate(b.from) || !validDate(b.to)) {
      return 'Completá fechas válidas para ambos períodos.';
    }
    if (a.from > a.to) return 'En el Período A, la fecha inicial debe ser anterior o igual a la final.';
    if (b.from > b.to) return 'En el Período B, la fecha inicial debe ser anterior o igual a la final.';
    return '';
  }, [mode, custom]);

  const resolved = useMemo(() => {
    if (mode === 'monthly') return resolveMonthlyComparison(monthA, monthB, today);
    if (mode === 'annual') return resolveAnnualComparison(yearA, yearB, today);
    if (customError) return null;
    return resolveCustomComparison(custom.a, custom.b);
  }, [mode, monthA, monthB, yearA, yearB, custom, customError, today]);

  // Para el par por defecto (mes actual vs mes anterior) reutilizamos la ventana compartida
  // de dos meses y evitamos duplicar llamadas RPC en la carga inicial de Estadísticas.
  const useSharedWindow = Boolean(resolved?.isDefaultCurrentVsPrevious && defaultTwoMonthQuery);
  const needsStats = Boolean(resolved && !useSharedWindow);

  const statsArgs = useMemo(() => (resolved ? {
    filters: { from: resolved.rangeA.from, to: resolved.rangeA.to, currency },
    reference: { from: resolved.rangeB.from, to: resolved.rangeB.to },
    month_offset: 0,
  } : null), [resolved, currency]);

  const statsQuery = useStats(api, statsArgs, needsStats);
  const activeQuery = useSharedWindow ? defaultTwoMonthQuery : statsQuery;

  const comparison = useMemo(() => {
    if (!resolved || !activeQuery.data) return null;
    if (useSharedWindow) {
      return buildPeriodComparisonFromExpenses(activeQuery.data, resolved.rangeA, resolved.rangeB, currency);
    }
    return buildPeriodComparisonFromStats(activeQuery.data);
  }, [resolved, activeQuery.data, useSharedWindow, currency]);

  const visibleCategories = useMemo(() => {
    if (!comparison) return [];
    return showAll ? comparison.categories : comparison.categories.slice(0, INITIAL_CATEGORIES);
  }, [comparison, showAll]);

  const updateCustom = (side, field) => (value) => {
    setCustom((current) => ({ ...current, [side]: { ...current[side], [field]: value } }));
  };

  return (
    <section
      className="panel pad stats-panel span-2"
      aria-labelledby="card-period-comparison"
      aria-busy={activeQuery.isFetching}
      data-card="period-comparison"
    >
      <div className="panel-title pc-head">
        <div>
          <h2 id="card-period-comparison">Comparación entre períodos</h2>
          <p className="card-subtitle">Diferencia total y qué categorías explican el cambio · {currency}</p>
        </div>
        <div className="segments pc-mode" role="group" aria-label="Tipo de comparación">
          <button type="button" aria-pressed={mode === 'monthly'} onClick={() => setMode('monthly')}>Mensual</button>
          <button type="button" aria-pressed={mode === 'annual'} onClick={() => setMode('annual')}>Anual</button>
          <button type="button" aria-pressed={mode === 'custom'} onClick={() => setMode('custom')}>Personalizada</button>
        </div>
      </div>

      <div className="pc-controls">
        {mode === 'monthly' && (
          <div className="pc-pair">
            <div className="field">
              <label htmlFor={`${id}-ma`}>Período A</label>
              <SpringSelect
                id={`${id}-ma`}
                value={monthA}
                options={monthOptions}
                onChange={setMonthA}
              />
            </div>
            <span className="pc-vs" aria-hidden="true">vs</span>
            <div className="field">
              <label htmlFor={`${id}-mb`}>Período B</label>
              <SpringSelect
                id={`${id}-mb`}
                value={monthB}
                options={monthOptions}
                onChange={setMonthB}
              />
            </div>
          </div>
        )}

        {mode === 'annual' && (
          <div className="pc-pair">
            <div className="field">
              <label htmlFor={`${id}-ya`}>Año A</label>
              <SpringSelect
                id={`${id}-ya`}
                value={yearA}
                options={yearOptions}
                onChange={setYearA}
              />
            </div>
            <span className="pc-vs" aria-hidden="true">vs</span>
            <div className="field">
              <label htmlFor={`${id}-yb`}>Año B</label>
              <SpringSelect
                id={`${id}-yb`}
                value={yearB}
                options={yearOptions}
                onChange={setYearB}
              />
            </div>
          </div>
        )}

        {mode === 'custom' && (
          <div className="pc-custom-grid">
            <fieldset className="pc-custom-group">
              <legend className="eyebrow">Período A</legend>
              <div className="pc-date-pair">
                <div className="field">
                  <label htmlFor={`${id}-af`}>Desde</label>
                  <IsoDatePicker id={`${id}-af`} value={custom.a.from} today={today} min="0001-01-01" max="9999-12-31"
                    onChange={updateCustom('a', 'from')} aria-invalid={Boolean(customError)} />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-at`}>Hasta</label>
                  <IsoDatePicker id={`${id}-at`} value={custom.a.to} today={today} min="0001-01-01" max="9999-12-31"
                    onChange={updateCustom('a', 'to')} aria-invalid={Boolean(customError)} />
                </div>
              </div>
            </fieldset>
            <fieldset className="pc-custom-group">
              <legend className="eyebrow">Período B</legend>
              <div className="pc-date-pair">
                <div className="field">
                  <label htmlFor={`${id}-bf`}>Desde</label>
                  <IsoDatePicker id={`${id}-bf`} value={custom.b.from} today={today} min="0001-01-01" max="9999-12-31"
                    onChange={updateCustom('b', 'from')} aria-invalid={Boolean(customError)} />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-bt`}>Hasta</label>
                  <IsoDatePicker id={`${id}-bt`} value={custom.b.to} today={today} min="0001-01-01" max="9999-12-31"
                    onChange={updateCustom('b', 'to')} aria-invalid={Boolean(customError)} />
                </div>
              </div>
            </fieldset>
          </div>
        )}

        {customError && <p className="field-error" role="alert">{customError}</p>}

        {resolved && (
          <div className="pc-context">
            <span className="small-data">
              <b>A</b> · {resolved.spanA}
            </span>
            <span className="small-data">
              <b>B</b> · {resolved.spanB}
            </span>
            {resolved.alignedPartial && (
              <span className="tag">
                Tramo equivalente{resolved.clamped ? ` (${resolved.daysA} vs ${resolved.daysB} días)` : ''}
              </span>
            )}
            {resolved.differentDuration && (
              <span className="tag">
                Duraciones distintas ({resolved.daysA} vs {resolved.daysB} días)
              </span>
            )}
          </div>
        )}
      </div>

      {!customError && (
        <PanelBody query={activeQuery} height={210} loading="Cargando comparación entre períodos…">
          {comparison && resolved && (
            <>
              <dl className="metrics pc-summary">
                <div>
                  <dt className="eyebrow">Período A · {resolved.labelA}</dt>
                  <dd className="figure" data-size={figureSize(money(comparison.periodA.total))}>
                    {comparison.periodA.count > 0 ? (
                      <HistoryLink
                        filters={{ from: resolved.rangeA.from, to: resolved.rangeA.to, currency }}
                        back={back}
                        label={`Período A (${resolved.spanA}): ${currency} ${money(comparison.periodA.total)}. Ver ${expensesCount(comparison.periodA.count)}`}
                      >
                        {money(comparison.periodA.total)}
                      </HistoryLink>
                    ) : (
                      <span className="muted-figure">0,00</span>
                    )}{' '}
                    <span className="unit">{currency}</span>
                  </dd>
                  <dd className="metric-note">{expensesCount(comparison.periodA.count)}</dd>
                </div>

                <div>
                  <dt className="eyebrow">Período B · {resolved.labelB}</dt>
                  <dd className="figure" data-size={figureSize(money(comparison.periodB.total))}>
                    {comparison.periodB.count > 0 ? (
                      <HistoryLink
                        filters={{ from: resolved.rangeB.from, to: resolved.rangeB.to, currency }}
                        back={back}
                        label={`Período B (${resolved.spanB}): ${currency} ${money(comparison.periodB.total)}. Ver ${expensesCount(comparison.periodB.count)}`}
                      >
                        {money(comparison.periodB.total)}
                      </HistoryLink>
                    ) : (
                      <span className="muted-figure">0,00</span>
                    )}{' '}
                    <span className="unit">{currency}</span>
                  </dd>
                  <dd className="metric-note">{expensesCount(comparison.periodB.count)}</dd>
                </div>

                <div>
                  <dt className="eyebrow">Diferencia (A vs B)</dt>
                  <dd
                    className={`figure pc-delta pc-delta--${deltaTone(comparison.deltaCents)}`}
                    data-size={figureSize(signedMoney(comparison.deltaText))}
                  >
                    {signedMoney(comparison.deltaText)} <span className="unit">{currency}</span>
                  </dd>
                  <dd className="metric-note">
                    {comparison.percentText !== null ? (
                      <span className={`pc-pct pc-delta--${deltaTone(comparison.deltaCents)}`}>
                        {percentage(comparison.percentText, { sign: true })}
                      </span>
                    ) : comparison.periodA.count === 0 && comparison.periodB.count === 0 ? (
                      'Sin gastos en ambos períodos'
                    ) : (
                      'Sin base en B'
                    )}
                  </dd>
                </div>
              </dl>

              {(comparison.topIncrease || comparison.topDecrease) && (
                <p className="pc-drivers">
                  {comparison.topIncrease && (
                    <span>
                      Mayor suba: <strong>{comparison.topIncrease.name}</strong>{' '}
                      <span className="pc-delta--up">
                        ({signedMoney(comparison.topIncrease.deltaText)} {currency})
                      </span>
                    </span>
                  )}
                  {comparison.topDecrease && (
                    <span>
                      Mayor baja: <strong>{comparison.topDecrease.name}</strong>{' '}
                      <span className="pc-delta--down">
                        ({signedMoney(comparison.topDecrease.deltaText)} {currency})
                      </span>
                    </span>
                  )}
                </p>
              )}

              {comparison.categories.length === 0 ? (
                <p className="panel-empty pc-empty">Sin gastos en {currency} en ninguno de los dos períodos.</p>
              ) : (
                <div className="pc-breakdown">
                  <div className="pc-breakdown-head">
                    <span className="eyebrow">Por categoría · mayor impacto primero</span>
                    <div className="pc-legend" aria-hidden="true">
                      <span className="pc-legend-item"><i className="pc-swatch pc-swatch--a" />{resolved.labelA}</span>
                      <span className="pc-legend-item"><i className="pc-swatch pc-swatch--b" />{resolved.labelB}</span>
                    </div>
                  </div>

                  <ul className="pc-cat-list">
                    {visibleCategories.map((row) => {
                      const tone = deltaTone(row.deltaCents);
                      const widthA = barPercent(row.aCents, comparison.maxCategoryCents);
                      const widthB = barPercent(row.bCents, comparison.maxCategoryCents);
                      return (
                        <li key={row.id} className="pc-cat-row">
                          <div className="pc-cat-top">
                            <span className="pc-cat-name">{row.name}</span>
                            <span className={`pc-cat-delta pc-delta--${tone}`}>
                              <span className="money">{signedMoney(row.deltaText)}</span>
                              <span className="pc-cat-badge">{categoryDeltaBadge(row)}</span>
                            </span>
                          </div>

                          <div className="pc-bars">
                            <div className="pc-bar-line">
                              <span className="pc-bar-tag">A</span>
                              <span className="track pc-track" aria-hidden="true">
                                {widthA > 0 && <span className="fill pc-fill-a" style={{ width: `${widthA}%` }} />}
                              </span>
                              <span className="pc-bar-val">
                                {row.aCount > 0 ? (
                                  <HistoryLink
                                    filters={{ from: resolved.rangeA.from, to: resolved.rangeA.to, currency, category_id: row.id }}
                                    back={back}
                                    label={`${row.name}, período A: ${currency} ${money(row.aTotal)}. Ver ${expensesCount(row.aCount)}`}
                                  >
                                    {money(row.aTotal)}
                                  </HistoryLink>
                                ) : (
                                  <span className="muted-text">0,00</span>
                                )}
                              </span>
                            </div>

                            <div className="pc-bar-line">
                              <span className="pc-bar-tag">B</span>
                              <span className="track pc-track" aria-hidden="true">
                                {widthB > 0 && <span className="fill pc-fill-b" style={{ width: `${widthB}%` }} />}
                              </span>
                              <span className="pc-bar-val">
                                {row.bCount > 0 ? (
                                  <HistoryLink
                                    filters={{ from: resolved.rangeB.from, to: resolved.rangeB.to, currency, category_id: row.id }}
                                    back={back}
                                    label={`${row.name}, período B: ${currency} ${money(row.bTotal)}. Ver ${expensesCount(row.bCount)}`}
                                  >
                                    {money(row.bTotal)}
                                  </HistoryLink>
                                ) : (
                                  <span className="muted-text">0,00</span>
                                )}
                              </span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {comparison.categories.length > INITIAL_CATEGORIES && (
                    <button
                      type="button"
                      className="btn ghost pc-more"
                      onClick={() => setShowAll((current) => !current)}
                    >
                      {showAll
                        ? 'Mostrar menos'
                        : `Ver las ${comparison.categories.length} categorías`}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </PanelBody>
      )}
    </section>
  );
}
