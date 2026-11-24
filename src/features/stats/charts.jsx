import { useId, useLayoutEffect, useRef } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis, useActiveTooltipLabel } from 'recharts';
import { compactAxis } from './format.js';

// Recharts se carga solo al abrir Estadísticas (React.lazy). Number se usa únicamente
// para la coordenada; tooltip, detalle y tabla muestran el decimal exacto del servidor.
// Interacción: puntero y toque muestran el tooltip; el clic o toque sobre la columna
// de un mes o el área de un punto lo selecciona (el destino es el propio elemento, no el
// índice activo, que Recharts mueve al recibir foco). Con teclado, la capa accesible
// recorre los datos con las flechas y Enter o Espacio selecciona el elemento activo.

const GRID = '#2b2d2e';
const AXIS = '#353739';

// Keeps the active tooltip label in a ref before paint, so Enter reads what is on screen.
function ActiveReporter({ target }) {
  const label = useActiveTooltipLabel();
  useLayoutEffect(() => { target.current = label ?? null; });
  return null;
}

function ChartFrame({ label, active, onSelect, children }) {
  return (
    <div className="stats-chart" role="group" aria-label={label}
      // A pointer must not focus the SVG: Recharts would activate the first item on focus
      // and its tooltip would contradict the point under the finger. Tab still focuses it.
      onMouseDown={(event) => { if (event.target instanceof Element && event.target.closest('svg')) event.preventDefault(); }}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && active.current !== null) {
          event.preventDefault();
          onSelect(active.current);
        }
      }}>
      {children}
    </div>
  );
}

function Tip({ active, payload, label, rows, render }) {
  if (!active) return null;
  const row = payload?.[0]?.payload ?? rows.find((entry) => entry.key === label);
  return row ? <div className="chart-tip">{render(row)}</div> : null;
}

// Barras de celdas discretas (UI-01): un patrón por barra, alineado con su borde y la base.
function SegmentBar({ x, y, width, height, index, payload, patternId, highlighted }) {
  if (!(height > 0) || !(width > 0)) return null;
  const id = `${patternId}-${index}`;
  const bottom = y + height;
  return (
    <g className="segment-bar">
      <defs>
        <pattern id={id} x={x} y={bottom} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect x="0" y="1" width="3" height="3" fill={payload.key === highlighted ? '#e6e5dc' : '#989e9d'} />
        </pattern>
      </defs>
      <rect x={x} y={y} width={width} height={height} fill={`url(#${id})`} />
    </g>
  );
}

export function MonthlyChart({ rows, highlighted, label, render, onSelect }) {
  const patternId = 'm' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const active = useRef(null);
  const labels = new Map(rows.map((row) => [row.key, row.label]));
  return (
    <ChartFrame label={label} active={active} onSelect={onSelect}>
      <BarChart data={rows} responsive style={{ width: '100%', height: 200 }} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
        >
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="key" tickFormatter={(key) => labels.get(key) ?? key} tickLine={false} axisLine={{ stroke: AXIS }}
          minTickGap={6} tickMargin={6} />
        <YAxis tickFormatter={compactAxis} tickLine={false} axisLine={false} width={46} />
        <Tooltip cursor={{ fill: '#ffffff0a' }} filterNull={false} isAnimationActive={false}
          content={<Tip rows={rows} render={render} />} />
        <Bar dataKey="value" maxBarSize={24} minPointSize={3} isAnimationActive={false}
          onClick={(item) => item?.payload && onSelect(item.payload.key)}
          background={(props) => <rect key={'hit' + props.index} className="chart-hit" x={props.x - 4} y={props.y} width={props.width + 8}
            height={props.height} fill="transparent" onClick={() => rows[props.index] && onSelect(rows[props.index].key)} />}
          shape={(props) => <SegmentBar {...props} patternId={patternId} highlighted={highlighted} />} />
        <ActiveReporter target={active} />
      </BarChart>
    </ChartFrame>
  );
}

function YearDot({ cx, cy, payload, selected, onSelect }) {
  if (payload?.value == null || cx == null || cy == null || Number.isNaN(cy)) return null;
  const chosen = payload.key === selected;
  return (
    <g className="year-dot" onClick={onSelect && (() => onSelect(payload.key))}>
      <circle cx={cx} cy={cy} r="14" fill="transparent" />
      <circle cx={cx} cy={cy} r="7" fill="#171819" />
      <circle cx={cx} cy={cy} r="4.5" fill={chosen ? '#f4f2eb' : '#232625'} stroke="#ededdf" strokeWidth="2"
        strokeDasharray={payload.partial ? '2.5 2' : undefined} />
    </g>
  );
}

export function AnnualChart({ rows, selected, label, render, onSelect }) {
  const active = useRef(null);
  // Años cerrados en una línea continua solo entre observaciones consecutivas
  // (connectNulls=false). El año parcial se une con un trazo punteado y nunca se
  // presenta como una variación comparable.
  const data = rows.map((row, index) => ({
    ...row,
    closed: row.partial ? null : row.value,
    partialLine: row.partial || (rows[index + 1]?.partial && rows[index + 1].value !== null) ? row.value : null,
  }));
  return (
    <ChartFrame label={label} active={active} onSelect={onSelect}>
      <LineChart data={data} responsive style={{ width: '100%', height: 200 }} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
        >
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="key" interval={0} tickLine={false} axisLine={{ stroke: AXIS }} padding={{ left: 18, right: 18 }} tickMargin={6} />
        <YAxis tickFormatter={compactAxis} tickLine={false} axisLine={false} width={46} domain={[0, 'auto']} />
        <Tooltip cursor={{ stroke: '#727679', strokeWidth: 1 }} filterNull={false} isAnimationActive={false}
          content={<Tip rows={data} render={render} />} />
        <Line dataKey="closed" stroke="#dedfd7" strokeWidth={2} connectNulls={false} isAnimationActive={false}
          dot={(props) => <YearDot key={props.key ?? props.index} {...props} selected={selected} onSelect={onSelect} />}
          activeDot={(props) => <YearDot key="active" {...props} selected={props.payload?.key} onSelect={onSelect} />} />
        <Line dataKey="partialLine" stroke="#dedfd7" strokeWidth={2} strokeDasharray="4 4" connectNulls={false}
          isAnimationActive={false} legendType="none" tooltipType="none"
          dot={(props) => props.payload?.partial
            ? <YearDot key={props.key ?? props.index} {...props} selected={selected} onSelect={onSelect} /> : <g key={props.key ?? props.index} />}
          activeDot={false} />
        <ActiveReporter target={active} />
      </LineChart>
    </ChartFrame>
  );
}
