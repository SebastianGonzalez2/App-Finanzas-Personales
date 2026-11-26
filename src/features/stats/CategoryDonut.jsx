import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon.jsx';
import { count, expensesCount, figureSize, money, percentage } from './format.js';
import { buildDonutSlices, DONUT_TICKS } from './insights.js';
import { categoryFilters, historyHref } from './links.js';

const CX = 110;
const CY = 110;
const R_OUTER_FRAME = 103;
const R_INNER_FRAME = 69;
const R_TICK_IN = 76;
const R_TICK_OUT = 96;
const R_TICK_IN_ACTIVE = 74;
const R_TICK_OUT_ACTIVE = 99;
const R_HIT_IN = 67;
const R_HIT_OUT = 105;

function polar(angle, radius) {
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

// Arco anular para el área de interacción de cada porción (soporta también el caso 100 %).
function sectorPath(startAngle, endAngle, innerR, outerR) {
  const sweep = endAngle - startAngle;
  if (sweep >= Math.PI * 2 - 0.0001) {
    const mid = startAngle + Math.PI;
    return [
      sectorPath(startAngle, mid, innerR, outerR),
      sectorPath(mid, endAngle, innerR, outerR),
    ].join(' ');
  }
  const large = sweep > Math.PI ? 1 : 0;
  const [x1, y1] = polar(startAngle, outerR);
  const [x2, y2] = polar(endAngle, outerR);
  const [x3, y3] = polar(endAngle, innerR);
  const [x4, y4] = polar(startAngle, innerR);
  return [
    `M${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A${outerR} ${outerR} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A${innerR} ${innerR} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function CategoryDonut({
  categories,
  total,
  totalCount,
  currency,
  filters,
  eyebrow,
  centerEyebrow = 'Total del mes',
  shareSuffix = 'del mes',
  legendLabel = 'Categorías del mes',
  back,
  isArchived,
  onBreakdown,
  getHistoryFilters,
  showOtherBreakdown = false,
}) {
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const slices = useMemo(
    () => buildDonutSlices(categories, total, { totalTicks: DONUT_TICKS }),
    [categories, total],
  );

  // Si cambia la moneda o los datos y la selección ya no existe, se ignora sin efecto secundario.
  const selectedSlice = slices.find((slice) => slice.id === selectedId) ?? null;
  const hoveredSlice = slices.find((slice) => slice.id === hoveredId) ?? null;
  const activeSlice = hoveredSlice ?? selectedSlice;

  const ticks = useMemo(() => {
    const out = [];
    for (const slice of slices) {
      for (let i = slice.startTick; i < slice.endTick; i += 1) {
        const angle = -Math.PI / 2 + ((i + 0.5) / DONUT_TICKS) * Math.PI * 2;
        out.push({ index: i, angle, sliceId: slice.id, color: slice.color });
      }
    }
    return out;
  }, [slices]);

  const toggleSelect = (id) => {
    setSelectedId((current) => (current === id ? null : id));
  };

  const resolveHistoryFilters = getHistoryFilters
    ?? ((slice) => categoryFilters(filters, slice.rawId ?? slice.id));

  const summaryLabel = slices
    .map((slice) => `${slice.name}: ${currency} ${money(slice.total)}, ${percentage(slice.share)}`)
    .join('; ');

  const centerAmount = activeSlice ? money(activeSlice.total) : money(total);
  const centerSize = figureSize(centerAmount);
  const topEyebrow = eyebrow ?? `Importe en ${currency} · % del mes`;

  return (
    <div
      className="cat-donut"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selectedId) {
          event.stopPropagation();
          setSelectedId(null);
        }
      }}
    >
      <p className="eyebrow">{topEyebrow}</p>

      <div className="cat-donut-layout">
        <div
          className="cat-donut-ring"
          onPointerLeave={(event) => {
            if (event.pointerType !== 'touch') setHoveredId(null);
          }}
        >
          <svg
            className="cat-donut-svg"
            viewBox="0 0 220 220"
            role="img"
            aria-label={`Distribución por categoría en ${currency}. ${summaryLabel}.`}
          >
            <circle cx={CX} cy={CY} r={R_OUTER_FRAME} fill="none" stroke="#2a2c2e" strokeWidth="1" />
            <circle cx={CX} cy={CY} r={R_INNER_FRAME} fill="none" stroke="#242628" strokeWidth="1" />

            <g className="cat-donut-ticks">
              {ticks.map((tick) => {
                const isActive = activeSlice?.id === tick.sliceId;
                const isDimmed = Boolean(activeSlice && !isActive);
                const rIn = isActive ? R_TICK_IN_ACTIVE : R_TICK_IN;
                const rOut = isActive ? R_TICK_OUT_ACTIVE : R_TICK_OUT;
                const [x1, y1] = polar(tick.angle, rIn);
                const [x2, y2] = polar(tick.angle, rOut);
                return (
                  <line
                    key={tick.index}
                    x1={x1.toFixed(2)}
                    y1={y1.toFixed(2)}
                    x2={x2.toFixed(2)}
                    y2={y2.toFixed(2)}
                    stroke={tick.color}
                    strokeWidth={isActive ? '4.7' : '4.1'}
                    strokeLinecap="butt"
                    opacity={isDimmed ? 0.25 : 1}
                    className="cat-donut-tick"
                    data-slice={tick.sliceId}
                  />
                );
              })}
            </g>

            <g className="cat-donut-hits">
              {slices.map((slice) => (
                <path
                  key={slice.id}
                  d={sectorPath(slice.startAngle, slice.endAngle, R_HIT_IN, R_HIT_OUT)}
                  fill="transparent"
                  className="cat-donut-hit"
                  data-slice={slice.id}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== 'touch') setHoveredId(slice.id);
                  }}
                  onClick={() => toggleSelect(slice.id)}
                />
              ))}
            </g>
          </svg>

          <div className="cat-donut-center" aria-live="polite">
            {activeSlice ? (
              <>
                <span className="cat-donut-center-label">
                  <span className="cat-donut-dot" style={{ backgroundColor: activeSlice.color }} aria-hidden="true" />
                  <span className="cat-donut-center-name">{activeSlice.name}</span>
                </span>
                <span className="cat-donut-center-value" data-size={centerSize}>
                  {centerAmount}
                </span>
                <span className="cat-donut-center-meta">
                  {currency} · {percentage(activeSlice.share)}
                </span>
                <span className="cat-donut-center-sub">{expensesCount(activeSlice.count)}</span>
              </>
            ) : (
              <>
                <span className="cat-donut-center-eyebrow">{centerEyebrow}</span>
                <span className="cat-donut-center-value" data-size={centerSize}>
                  {centerAmount}
                </span>
                <span className="cat-donut-center-meta">{currency}</span>
                <span className="cat-donut-center-sub">{expensesCount(totalCount)}</span>
              </>
            )}
          </div>
        </div>

        <ul className="cat-donut-legend" aria-label={legendLabel}>
          {slices.map((slice) => {
            const isSelected = selectedSlice?.id === slice.id;
            const isActive = activeSlice?.id === slice.id;
            const isDimmed = Boolean(activeSlice && !isActive);
            const archived = !slice.isOther && Boolean(isArchived?.(slice.id));
            return (
              <li key={slice.id}>
                <button
                  type="button"
                  className="cat-donut-item"
                  aria-pressed={isSelected}
                  data-active={isActive || undefined}
                  data-dimmed={isDimmed || undefined}
                  data-slice={slice.id}
                  aria-label={`${slice.name}: ${currency} ${money(slice.total)}, ${percentage(slice.share)} ${shareSuffix}, ${expensesCount(slice.count)}`}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== 'touch') setHoveredId(slice.id);
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType !== 'touch') setHoveredId(null);
                  }}
                  onFocus={() => setHoveredId(slice.id)}
                  onBlur={() => setHoveredId(null)}
                  onClick={() => toggleSelect(slice.id)}
                >
                  <span className="cat-donut-swatch" style={{ '--swatch': slice.color }} aria-hidden="true" />
                  <span className="cat-donut-item-name">
                    {slice.name}
                    {archived && <small className="archived-mark">Archivada</small>}
                    <small className="muted-text"> · {count(slice.count)}</small>
                  </span>
                  <span className="cat-donut-item-amount">
                    <span className="money">{money(slice.total)}</span>
                    <small className="muted-text"> · {percentage(slice.share)}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selectedSlice && (
        <div className="cat-donut-detail" role="region" aria-label={`Detalle de ${selectedSlice.name}`}>
          <div className="cat-donut-detail-head">
            <div className="cat-donut-detail-info">
              <span className="cat-donut-dot" style={{ backgroundColor: selectedSlice.color }} aria-hidden="true" />
              <strong>{selectedSlice.name}</strong>
              <span className="small-data">
                {currency} {money(selectedSlice.total)} · {percentage(selectedSlice.share)} · {expensesCount(selectedSlice.count)}
              </span>
            </div>
            <div className="cat-donut-detail-actions">
              {selectedSlice.isOther ? (
                !showOtherBreakdown && (
                  <Link className="history-link" to="/estadisticas">
                    Ver en Estadísticas<Icon name="up" />
                  </Link>
                )
              ) : (
                <>
                  {onBreakdown && (
                    <button
                      type="button"
                      className="btn ghost cat-donut-clear"
                      onClick={() => onBreakdown(selectedSlice.rawId ?? selectedSlice.id)}
                    >
                      Ver subcategorías
                    </button>
                  )}
                  <Link
                    className="history-link"
                    to={historyHref(resolveHistoryFilters(selectedSlice), back)}
                    aria-label={`Ver gastos de ${selectedSlice.name}`}
                  >
                    Ver gastos<Icon name="up" />
                  </Link>
                </>
              )}
              <button type="button" className="btn ghost cat-donut-clear" onClick={() => setSelectedId(null)}>
                Ver total
              </button>
            </div>
          </div>

          {selectedSlice.isOther && showOtherBreakdown && selectedSlice.restItems?.length > 0 && (
            <ul className="cat-donut-other-list" aria-label={`Detalle de ${selectedSlice.name}`}>
              {selectedSlice.restItems.map((item) => {
                const archived = Boolean(isArchived?.(item.id));
                return (
                  <li key={item.id} className="cat-donut-other-item">
                    <div className="cat-donut-other-name">
                      <span>{item.name}</span>
                      {archived && <small className="archived-mark">Archivada</small>}
                      <small className="muted-text"> · {count(item.count)}</small>
                    </div>
                    <div className="cat-donut-other-meta">
                      <span className="small-data">
                        {currency} {money(item.total)} · {percentage(item.share)}
                      </span>
                      <span className="cat-donut-other-actions">
                        {onBreakdown && (
                          <button
                            type="button"
                            className="btn ghost cat-donut-clear"
                            onClick={() => onBreakdown(item.rawId ?? item.id)}
                          >
                            Subcategorías
                          </button>
                        )}
                        <Link
                          className="history-link"
                          to={historyHref(resolveHistoryFilters(item), back)}
                          aria-label={`Ver gastos de ${item.name}`}
                        >
                          Ver gastos<Icon name="up" />
                        </Link>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
