import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatIsoDate, parseIsoDate } from '../../src/components/DatePicker.jsx';

const selectCss = readFileSync(new URL('../../src/components/SpringSelect.css', import.meta.url), 'utf8');
const dateCss = readFileSync(new URL('../../src/components/DatePicker.css', import.meta.url), 'utf8');

function solveSpring(stiffness, damping, mass) {
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const w0 = Math.sqrt(stiffness / mass) / 1000;
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const at = (t) => {
    const A = (zeta * w0) / wd;
    const env = Math.exp(-zeta * w0 * t);
    const value = 1 - env * (A * Math.sin(wd * t) + Math.cos(wd * t));
    const velocity = env * ((zeta * w0 * A + wd) * Math.sin(wd * t) + (zeta * w0 - A * wd) * Math.cos(wd * t)) * 1000;
    return { value, velocity };
  };
  let duration = 0;
  for (let t = 0; t < 2000; t += 1) {
    const { value, velocity } = at(t);
    if (t > 20 && Math.abs(velocity) <= 0.01 && Math.abs(1 - value) <= 0.005) {
      duration = t;
      break;
    }
  }
  return { duration, at };
}

function readCurve(css, variable) {
  const match = css.match(new RegExp(`${variable}:\\s*linear\\(([^)]*)\\)`));
  return match[1].split(',').map(Number);
}

describe('SpringSelect: física del resorte y accesibilidad', () => {
  it('reproduce springSnappy (stiffness 500, damping 30, mass 0.8) para el menú', () => {
    const { duration, at } = solveSpring(500, 30, 0.8);
    const points = readCurve(selectCss, '--spring-select-snappy');
    const cssDuration = Number(selectCss.match(/spring-select-open-down\s+(\d+)ms/)[1]);
    expect(cssDuration).toBe(duration);
    expect(points).toHaveLength(Math.round(duration / 10));
    points.forEach((point, index) => {
      const t = (duration * index) / (points.length - 1);
      const expected = index === points.length - 1 ? 1 : at(t).value;
      expect(Math.abs(point - expected)).toBeLessThanOrEqual(0.0001);
    });
    expect(Math.max(...points)).toBeGreaterThan(1.02);
  });

  it('reproduce el sobrepaso del chevron más allá de 180° antes de asentarse', () => {
    const { duration, at } = solveSpring(500, 24, 0.8);
    const points = readCurve(selectCss, '--spring-select-chevron');
    const cssDuration = Number(selectCss.match(/transition:\s*transform\s+(\d+)ms\s+var\(--spring-select-chevron\)/)[1]);
    expect(cssDuration).toBe(duration);
    expect(points).toHaveLength(Math.round(duration / 10));
    points.forEach((point, index) => {
      const t = (duration * index) / (points.length - 1);
      const expected = index === points.length - 1 ? 1 : at(t).value;
      expect(Math.abs(point - expected)).toBeLessThanOrEqual(0.0001);
    });
    // 180° × 1,0941 ≈ 196,9° (pasa levemente de 180° antes de volver a 180°).
    expect(Math.max(...points) * 180).toBeGreaterThan(192);
  });

  it('desactiva animaciones y transiciones con prefers-reduced-motion', () => {
    expect(selectCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(selectCss).toMatch(/\.spring-select__menu[\s\S]*animation:\s*none;/);
  });
});

describe('DatePicker: física del popover y fechas civiles ISO', () => {
  it('reproduce el resorte exacto de EasyUI (stiffness 520, damping 38, mass 0.7)', () => {
    const { duration, at } = solveSpring(520, 38, 0.7);
    const points = readCurve(dateCss, '--date-picker-spring');
    const cssDuration = Number(dateCss.match(/date-picker-in\s+(\d+)ms/)[1]);
    expect(cssDuration).toBe(duration);
    expect(points).toHaveLength(Math.round(duration / 10));
    points.forEach((point, index) => {
      const t = (duration * index) / (points.length - 1);
      const expected = index === points.length - 1 ? 1 : at(t).value;
      expect(Math.abs(point - expected)).toBeLessThanOrEqual(0.0001);
    });
  });

  it('convierte fechas civiles ISO sin desfasajes de zona horaria ni años bisiestos inválidos', () => {
    const leap = parseIsoDate('2024-02-29');
    expect(leap).not.toBeNull();
    expect(formatIsoDate(leap)).toBe('2024-02-29');

    expect(parseIsoDate('2023-02-29')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
    expect(formatIsoDate(null)).toBe('');

    const early = parseIsoDate('0001-01-01');
    expect(early.getFullYear()).toBe(1);
    expect(formatIsoDate(early)).toBe('0001-01-01');

    const late = parseIsoDate('9999-12-31');
    expect(late.getFullYear()).toBe(9999);
    expect(formatIsoDate(late)).toBe('9999-12-31');
  });

  it('desactiva animaciones con prefers-reduced-motion', () => {
    expect(dateCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(dateCss).toMatch(/\.date-picker__popover[\s\S]*animation:\s*none;/);
  });
});
