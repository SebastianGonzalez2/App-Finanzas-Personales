import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// La estrella de «Mis favoritos» reproduce el resorte del botón «Favorite» de Amicro
// (Motion, type: "spring", stiffness: 600, damping: 28). Se recalcula con la misma solución
// analítica y los mismos umbrales de reposo de motion-dom 12 (generators/spring.mjs).
const css = readFileSync(new URL('../../src/features/stats/FavoriteStar.css', import.meta.url), 'utf8');
const stiffness = 600, damping = 28, mass = 1;
const zeta = damping / (2 * Math.sqrt(stiffness * mass));
const w0 = Math.sqrt(stiffness / mass) / 1000; // rad/ms
const wd = w0 * Math.sqrt(1 - zeta * zeta);

function spring(origin, target, t) {
  const delta = target - origin;
  const A = (zeta * w0 * delta) / wd;
  const envelope = Math.exp(-zeta * w0 * t);
  const value = target - envelope * (A * Math.sin(wd * t) + delta * Math.cos(wd * t));
  const velocity = envelope * ((zeta * w0 * A + delta * wd) * Math.sin(wd * t) + (zeta * w0 * delta - A * wd) * Math.cos(wd * t)) * 1000;
  return { value, velocity };
}

// Escala 0,5 → 1: |delta| < 5, así que Motion usa restSpeed 0,01 y restDelta 0,005.
function restTime() {
  for (let t = 0; ; t += 1) {
    const { value, velocity } = spring(0.5, 1, t);
    if (Math.abs(velocity) <= 0.01 && Math.abs(1 - value) <= 0.005) return t;
  }
}

describe('estrella de favoritos', () => {
  const points = css.match(/--fav-spring:\s*linear\(([^)]*)\)/)[1].split(',').map(Number);
  const duration = Number(css.match(/transition-duration:\s*(\d+)ms/)[1]);

  it('dura lo que tarda el resorte original en quedar en reposo', () => {
    expect(duration).toBe(restTime());
  });

  it('sigue la curva del resorte con un punto cada 10 ms', () => {
    expect(points).toHaveLength(Math.round(duration / 10));
    points.forEach((point, index) => {
      const t = (duration * index) / (points.length - 1);
      const expected = index === points.length - 1 ? 1 : spring(0, 1, t).value;
      expect(Math.abs(point - expected)).toBeLessThanOrEqual(0.00005);
    });
    // Sobrepaso del original: la estrella que entra llega a ≈ 1,056 y la que sale baja a ≈ 0,444.
    expect(Math.max(...points)).toBeCloseTo(1.1119, 4);
  });

  it('cruza escala 0,5 y opacidad 0, y no se anima con prefers-reduced-motion', () => {
    expect(css).toMatch(/\.fav-star-on,\s*\.fav\[aria-pressed="true"\] \.fav-star-off \{ opacity: 0; transform: scale\(\.5\); \}/);
    expect(css).toMatch(/transition-property: opacity, transform;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.fav\[data-animated\] \.fav-star-layer \{ transition: none; \}/);
  });
});
