import { percentage } from '../stats/format.js';

// Arco de UI-01 (lámina 03): 50 marcas radiales cuya escala termina en 100 %. Por encima
// del límite el arco queda completo y sus últimas marcas pasan a rosa; el centro conserva
// el porcentaje real (106,67 %). Number solo decide cuántas marcas se encienden.
const TICKS = 50;
const point = (angle, radius) => [100 + radius * Math.cos(angle), 100 + radius * Math.sin(angle)];

export function Gauge({ percent, over }) {
  const lit = Math.min(TICKS, Math.round(Number(percent) / 2));
  const label = percentage(percent);
  return (
    <svg className="gauge" viewBox="0 0 200 116" role="img" aria-label={`${label} utilizado`}>
      <path d="M5 100a95 95 0 0 1 190 0" fill="none" stroke="#3c3e40" />
      {Array.from({ length: TICKS }, (_, index) => {
        const angle = Math.PI + (index * Math.PI) / (TICKS - 1);
        const [x1, y1] = point(angle, 76);
        const [x2, y2] = point(angle, 88);
        const stroke = index >= lit ? '#424546' : over && index >= TICKS - 5 ? 'var(--rose)' : '#deded5';
        return <path key={index} d={`M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`} stroke={stroke} strokeWidth="2.7" />;
      })}
      <text x="100" y="94" textAnchor="middle">{label}</text>
    </svg>
  );
}
