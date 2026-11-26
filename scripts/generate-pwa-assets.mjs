// Genera los iconos de la app instalada y las imágenes de arranque de iOS a partir del vector
// public/cifra.svg, cada PNG dibujado directamente a su tamaño final (sin reescalar mapas de bits).
//
//   npm run assets:pwa
//
// Si cambia el diseño, subí VERSION y actualizá las rutas de public/manifest.webmanifest,
// index.html (apple-touch-icon) y las pruebas: una URL nueva es lo que obliga a Android e iOS a
// descargar los iconos otra vez. Las etiquetas de arranque de index.html se reescriben solas.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const VERSION = 'v2';
const BACKGROUND = '#101112'; // background_color del manifiesto
const MARK_RATIO = 0.68; // lado del viewBox del logo respecto del lado del icono
const SPLASH_ICON = 192; // lado, en puntos CSS, del icono centrado en la imagen de arranque

const ICONS = [144, 192, 256, 384, 512, 1024];
const APPLE_ICONS = [152, 167, 180];
// [ancho, alto, densidad] en puntos CSS y vertical. Los iPad suman la variante horizontal.
const IPHONES = [
  [320, 568, 2], [375, 667, 2], [414, 736, 3], [375, 812, 3], [414, 896, 2], [414, 896, 3],
  [390, 844, 3], [428, 926, 3], [393, 852, 3], [430, 932, 3], [402, 874, 3], [420, 912, 3], [440, 956, 3],
];
const IPADS = [
  [744, 1133, 2], [768, 1024, 2], [810, 1080, 2], [820, 1180, 2], [834, 1112, 2], [834, 1194, 2],
  [834, 1210, 2], [1024, 1366, 2], [1032, 1376, 2],
];

const root = new URL('../', import.meta.url);
const output = new URL(`public/pwa/${VERSION}/`, root);
const logo = await readFile(new URL('public/cifra.svg', root), 'utf8');
const viewBox = logo.match(/viewBox="([^"]+)"/)[1];
const shapes = logo.slice(logo.indexOf('>') + 1, logo.lastIndexOf('</svg>'));

const splashes = [...IPHONES, ...IPADS].flatMap(([width, height, ratio]) => {
  const orientations = width >= 744 ? ['portrait', 'landscape'] : ['portrait'];
  return orientations.map((orientation) => {
    const [w, h] = orientation === 'portrait' ? [width, height] : [height, width];
    return {
      file: `splash-${w * ratio}x${h * ratio}.png`,
      width: w * ratio,
      height: h * ratio,
      icon: SPLASH_ICON * ratio,
      media: `screen and (device-width: ${width}px) and (device-height: ${height}px)`
        + ` and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})`,
    };
  });
});

const square = (file, side) => ({ file, width: side, height: side, icon: side });
const images = [
  ...ICONS.map((side) => square(`icon-${side}.png`, side)),
  ...APPLE_ICONS.map((side) => square(`apple-touch-icon-${side}.png`, side)),
  ...splashes,
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CIFRA_CHROMIUM_PATH,
  args: ['--force-color-profile=srgb'],
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, width, height, icon } of images) {
    const mark = icon * MARK_RATIO;
    await page.setViewportSize({ width, height });
    await page.setContent(`<body style="margin:0">
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="display:block">
        <rect width="100%" height="100%" fill="${BACKGROUND}"/>
        <svg x="${(width - mark) / 2}" y="${(height - mark) / 2}" width="${mark}" height="${mark}" viewBox="${viewBox}">${shapes}</svg>
      </svg>`);
    await page.screenshot({ path: fileURLToPath(new URL(file, output)) });
  }
} finally {
  await browser.close();
}

const html = new URL('index.html', root);
const source = await readFile(html, 'utf8');
const links = splashes.map(({ file, media }) =>
  `    <link rel="apple-touch-startup-image" media="${media}" href="/pwa/${VERSION}/${file}">`);
const block = /( *<!-- pwa:splash -->)[\s\S]*?( *<!-- \/pwa:splash -->)/;
if (!block.test(source)) throw new Error('index.html no tiene los marcadores pwa:splash');
const eol = source.includes('\r\n') ? '\r\n' : '\n';
await writeFile(html, source.replace(block, (_, open, close) => [open, ...links, close].join(eol)));

console.log(`${images.length} imágenes en public/pwa/${VERSION}/`);
