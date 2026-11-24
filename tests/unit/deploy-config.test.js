import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deploymentProblem } from '../../src/lib/supabaseConfig.js';

// IMP-06 · Preparación para Vercel (ARCH-01 §7 y §13). Vercel interpreta cada `source` como un
// patrón anclado (path-to-regexp); estos patrones solo usan grupos con expresiones regulares,
// equivalentes a un RegExp anclado.
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const matches = (source, path) => new RegExp('^' + source + '$').test(path);
const rewritten = (path) => config.rewrites.some(({ source }) => matches(source, path));
const headersFor = (path) => Object.fromEntries(config.headers
  .filter(({ source }) => matches(source, path)).flatMap(({ headers }) => headers.map(({ key, value }) => [key, value])));

describe('vercel.json', () => {
  it('compila con el lockfile y publica dist', () => {
    expect(config).toMatchObject({ framework: 'vite', installCommand: 'npm ci', buildCommand: 'npm run build', outputDirectory: 'dist' });
  });

  it('las rutas de la SPA, incluido el callback de OAuth, cargan index.html al abrirse directamente', () => {
    for (const path of ['/', '/estadisticas', '/historial', '/presupuestos', '/categorias', '/cuenta', '/login',
      '/auth/callback', '/gastos/nuevo', '/gastos/00000000-0000-4000-8000-000000000101/editar', '/ruta-inexistente']) {
      expect(rewritten(path), path).toBe(true);
    }
    expect(config.rewrites.every(({ destination }) => destination === '/index.html')).toBe(true);
  });

  it('los archivos estáticos no se reescriben: un asset ausente da 404 en lugar de HTML', () => {
    for (const path of ['/assets/index-abc123.js', '/assets/no-existe.js', '/cifra.svg', '/manifest.webmanifest',
      '/icon-192.png', '/icon-512.png', '/index.html']) {
      expect(rewritten(path), path).toBe(false);
    }
  });

  it('cabeceras de seguridad en todas las respuestas', () => {
    for (const path of ['/', '/historial', '/assets/index-abc123.js']) {
      expect(headersFor(path)).toMatchObject({
        'Content-Security-Policy': "frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
    }
  });

  it('solo los assets con hash se guardan un año; el HTML se revalida en cada visita', () => {
    expect(headersFor('/assets/index-abc123.js')['Cache-Control']).toBe('public, max-age=31536000, immutable');
    for (const path of ['/', '/index.html', '/historial', '/cifra.svg', '/manifest.webmanifest']) {
      expect(headersFor(path)['Cache-Control'], path).toBeUndefined();
    }
  });

  it('el manifiesto PWA declara start_url, scope e id estables en la raíz', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8'));
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Cifra',
      short_name: 'Cifra',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.icons.map(({ sizes }) => sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('todo lo publicado bajo /assets lleva hash en el nombre', () => {
    const dist = new URL('../../dist/assets/', import.meta.url);
    let files;
    try { files = readdirSync(dist); } catch { return; } // sin build previo
    for (const file of files) expect(file, file).toMatch(/-[\w-]{8}\.[a-z0-9]+$/);
  });
});

describe('deploymentProblem (build en Vercel)', () => {
  const dev = { url: 'https://ljbrukrakumuatjnwxwd.supabase.co', key: 'sb_publishable_x' };
  const prod = { url: 'https://otroproyecto.supabase.co', key: 'sb_publishable_y' };
  it('fuera de Vercel no interviene (desarrollo local, pruebas)', () => {
    expect(deploymentProblem(undefined, null)).toBeNull();
  });
  it('en Vercel exige configuración válida en cualquier entorno', () => {
    for (const env of ['production', 'preview', 'development']) expect(deploymentProblem(env, null)).toMatch(/Faltan/);
  });
  it('Producción no puede apuntar al proyecto de desarrollo; Preview sí', () => {
    expect(deploymentProblem('production', dev)).toMatch(/desarrollo/);
    expect(deploymentProblem('preview', dev)).toBeNull();
    expect(deploymentProblem('production', prod)).toBeNull();
  });
});
