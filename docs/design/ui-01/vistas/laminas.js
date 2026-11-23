// Composición de láminas estáticas con datos de ejemplo. Solo se navega entre propuestas.
const query = new URLSearchParams(location.search);
const names = {
  resumen: "Resumen",
  estadisticas: "Estadísticas",
  historial: "Historial",
  presupuestos: "Presupuestos",
  gasto: "Nuevo gasto",
  login: "Acceso",
};
const page = Object.hasOwn(names, query.get("vista"))
  ? query.get("vista")
  : "resumen";
const compact = query.get("nav") === "compacta";
const paths = {
  resumen: "M3 10 12 3l9 7v10h-6v-6H9v6H3z",
  historial: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6m-6 4h6",
  estadisticas: "M4 20h16 M6 16v-4m6 4V5m6 11V9",
  presupuestos: "M3 16a9 9 0 1 1 18 0 M12 15l4-6 M4 19h16",
  categorias: "M3 4h8l10 10-7 7L3 10z M7 7h.01",
  cuenta:
    "M4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  panel: "M3 4h18v16H3z M9 4v16",
  menu: "M3 6h18M3 12h18M3 18h18",
  up: "M6 18 18 6M6 6h12v12",
  right: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  date: "M3 6h18v15H3z M7 3v6m10-6v6M3 11h18",
  more: "M4 12h1m6 0h1m6 0h1",
  cart: "M2 4h3l3 11h10l3-8H6 M9 20h1m6 0h1",
  bus: "M4 7q0-4 4-4h8q4 0 4 4v11H4z M5 11h14m-12 4h1m8 0h1 M6 19v2m12-2v2",
  house: "M3 11 12 3l9 8 M5 10v11h14V10 M10 21v-7h4v7",
  power: "m13 2-9 12h7l-1 8 10-13h-8z",
  filters: "M3 6h9m4 0h5M3 17h4m4 0h10 M12 3v6m-5 5v6",
  search: "M16 16l5 5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z",
  star: "m12 2 3 6.5 7 1-5 5 1.2 7-6.2-3.4-6.2 3.4 1.2-7-5-5 7-1z",
  lock: "M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 6v6l4 2",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 11v6m0-11v1",
  back: "m14 5-7 7 7 7",
  fold: "M5 4h14v16H5z M8 8h8 M8 12h6",
  check: "m4 12 5 5L20 6",
};
function icon(id) {
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="${paths[id]}"/></svg>`;
}
const brand = `<span class="brand"><svg class="mark" viewBox="0 0 36 36" aria-hidden="true"><path d="m3 25 10-17 8-4-11 19z" fill="#f4f2eb"/><path d="m11 27 11-19 6 1-11 19z" fill="#aeb1af"/><path d="m18 30 11-19 4 4-8 14z" fill="#717775"/></svg><span class="name">Pliegue</span></span>`;
const url = (id, rail = false) =>
  `?vista=${id}${rail ? "&amp;nav=compacta" : ""}`;
function btn(label, id = "", style = "", href = "") {
  const inner = (id ? icon(id) : "") + label;
  return href
    ? `<a class="btn ${style}" href="${href}">${inner}</a>`
    : `<span class="btn ${style}">${inner}</span>`;
}
const add = btn("Nuevo gasto", "plus", "primary", url("gasto"));
const currency = `<div class="seg" aria-label="Moneda seleccionada UYU"><span class="on">UYU</span><span>USD</span><span>EUR</span></div>`;
const link = (label, id) =>
  `<a class="panel-link" href="${url(id)}">${label}${icon("up")}</a>`;
const tag = (label, color = "") => `<span class="tag ${color}">${label}</span>`;
const sectionTitle = (title, action = "") =>
  `<div class="panel-title"><h2>${title}</h2>${action}</div>`;
const fav = `<span class="fav" aria-label="Marcar como favorito">${icon("star")}</span>`;
function chartTable(headers, rows, label) {
  return `<details class="chart-details"><summary>Ver datos</summary><table aria-label="${label}"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
}
function navItem(id, title) {
  const content = icon(id) + `<span>${title}</span>`;
  return names[id]
    ? `<a aria-label="${title}" title="${title}" class="navitem ${page === id ? "current" : ""}" href="${url(id, compact)}">${content}</a>`
    : `<div class="navitem" title="${title}">${content}</div>`;
}
function sidebar() {
  return `<aside class="rail"><div class="rail-inner"><div class="rail-head">${brand}<a class="square" href="${url(page, !compact)}" aria-label="Alternar barra lateral">${icon("panel")}</a></div><nav><div class="eyebrow rail-label">Mi espacio</div>${["resumen", "estadisticas", "historial", "presupuestos"].map((id) => navItem(id, names[id])).join("")}<div class="navdiv"></div><div class="eyebrow rail-label">Organización</div>${navItem("categorias", "Categorías")}</nav><div class="rail-foot">${navItem("cuenta", "Mi cuenta")}</div></div></aside>`;
}
function shell(content) {
  return `<div class="shell ${compact ? "compact" : ""}">${sidebar()}<div><header class="topbar"><div class="crumb">${icon("fold")} Espacio personal <span class="slash">/</span> ${names[page]}</div><div class="context">${icon("date")}<span class="mono">23 nov 2026</span></div></header><div class="mobile-head"><div class="inline"><a class="square" aria-label="Ver menú" href="${url(page)}&amp;menu=1">${icon("menu")}</a>${brand}</div>${page !== "gasto" ? add : ""}</div><main>${content}</main></div></div>`;
}
function header(title, sub, actions = "") {
  return `<header class="page-head"><div><h1>${title}</h1><p class="subtitle">${sub}</p></div><div class="actions">${actions}<span class="desk-only">${page !== "gasto" ? add : ""}</span></div></header>`;
}
function engraving(className) {
  let lines = "";
  for (let i = 0; i < 35; i++) {
    const d = i * 6;
    lines += `<path d="M${-240 + d} 510 C${155 + d} 460 ${-10 + d} 260 ${170 + d} 176 S${247 + d} -42 ${506 + d} -92"/>`;
  }
  return `<svg class="${className}" viewBox="0 0 420 410" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1">${lines}</g></svg>`;
}
const formatNumber = new Intl.NumberFormat("es-UY", { useGrouping: "always" });
const fmt = (n) => formatNumber.format(n);
const months = ["May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov"];
const monthValues = [23600, 27200, 24800, 30400, 30000, 32000, 28640];
function monthly(start) {
  const labels = months.slice(start, start + 6),
    values = monthValues.slice(start, start + 6);
  const bars = values
    .map((n, i) => {
      const x = 36 + i * 45;
      const h = (84 * n) / 40000;
      const color = i === 5 ? "#e6e5dc" : "#989e9d";
      let squares = "";
      for (let y = 0; y < h; y += 4) {
        squares += `<path d="M${x} ${100 - y}h24" stroke="${color}" stroke-width="${Math.min(2, h - y)}" stroke-dasharray="3 1"/>`;
      }
      return `${squares}<text x="${x + 12}" y="119" text-anchor="middle" class="axis">${labels[i]}</text>`;
    })
    .join("");
  return `<svg class="chart" style="max-height:164px" viewBox="0 0 300 125" role="img" aria-label="${values.map((n, i) => labels[i] + ": UYU " + fmt(n)).join(", ")}">${[0, 20, 40].map((n) => `<path d="M32 ${100 - 2.1 * n}h264" stroke="#343638" stroke-dasharray="2 4"/><text x="0" y="${103 - 2.1 * n}" class="axis">${n ? n + "k" : "0"}</text>`).join("")}${bars}</svg>`;
}
const icons = ["cart", "house", "bus", "power"],
  categories = ["Alimentación", "Vivienda", "Transporte", "Servicios"];
function catRows(values, total, counts) {
  return values
    .map((v, i) => {
      let share = (v / total) * 100;
      return `<div class="cat-row"><div class="cat-name">${icon(icons[i])}${categories[i]}${counts ? `<small class="muted">· ${counts[i]}</small>` : ""}</div><div class="amount">${fmt(v)} <small class="muted">· ${fmt(Math.round(share))}%</small></div><div class="track"><div class="fill" style="width:${share}%;--ink:${["#d9d8d0", "#b5b8b6", "#929b9b", "#818989"][i]}"></div></div></div>`;
    })
    .join("");
}
function gauge(pct) {
  let ticks = "";
  for (let i = 0; i < 50; i++) {
    const angle = Math.PI + (i * Math.PI) / 49;
    const xy = (r) =>
      [100 + r * Math.cos(angle), 100 + r * Math.sin(angle)].join(" ");
    ticks += `<path d="M${xy(76)} L${xy(88)}" stroke="${i < Math.min(50, Math.round(pct / 2)) ? (i >= 45 && pct > 100 ? "#e5a6a3" : "#deded5") : "#424546"}" stroke-width="2.7"/>`;
  }
  return `<svg class="gauge" viewBox="0 0 200 116" aria-label="${fmt(pct)} por ciento utilizado" role="img"><path d="M5 100a95 95 0 0 1 190 0" fill="none" stroke="#3c3e40"/>${ticks}<text x="100" y="94" text-anchor="middle">${fmt(pct)}%</text></svg>`;
}
const expenses = [
  [
    "Compra semanal",
    "Alimentación",
    "Supermercado",
    "23 nov",
    "UYU",
    "1.280,00",
    "cart",
  ],
  [
    "Viaje al centro",
    "Transporte",
    "Taxi/Uber",
    "22 nov",
    "UYU",
    "340,00",
    "bus",
  ],
  [
    "Suscripción de cine",
    "Entretenimiento",
    "",
    "21 nov",
    "USD",
    "12,00",
    "historial",
  ],
  [
    "Cena del sábado",
    "Alimentación",
    "Restaurantes",
    "21 nov",
    "UYU",
    "920,00",
    "cart",
  ],
  ["Electricidad", "Servicios", "", "19 nov", "UYU", "2.400,00", "power"],
  [
    "Alquiler de noviembre",
    "Vivienda",
    "Alquiler",
    "18 nov",
    "UYU",
    "9.600,00",
    "house",
  ],
  [
    "Recarga de boleto",
    "Transporte",
    "Transporte público",
    "17 nov",
    "UYU",
    "800,00",
    "bus",
  ],
];
function expenseTable(rows, all) {
  return `<table class="expense-table"><thead><tr><th>Descripción</th><th>Categoría</th><th>Fecha ↓</th><th class="right">Importe</th>${all ? "<th></th>" : ""}</tr></thead><tbody>${rows.map(([desc, cat, sub, date, cur, val, ic]) => `<tr><td><div class="entry"><span class="tile">${icon(ic)}</span><div>${desc}<small class="desk-only">${sub || "—"}</small><small class="mobile-only">${date} · ${cat}${sub ? " · " + sub : ""}</small></div></div></td><td class="hide-phone">${cat}</td><td class="hide-phone small-data">${date} 2026</td><td class="right money"><small>${cur}</small>${val}</td>${all ? `<td class="hide-phone">${icon("more")}</td>` : ""}</tr>`).join("")}</tbody></table>`;
}
function overview() {
  return (
    header("Resumen", "Noviembre de 2026", currency) +
    `<div class="grid duo"><section class="panel pad hero">${engraving("etch")}<div class="hero-label"><span class="eyebrow">Gasto del mes</span>${tag("Mes parcial")}</div><div><div class="hero-value">28.640 <span class="unit">UYU</span></div><p class="hero-note">24 gastos registrados</p></div><div class="hero-base"><span class="small-data">−3.360 UYU</span> <span class="hero-note">frente a octubre completo</span></div></section><section class="panel pad">${sectionTitle("Evolución mensual", link("Estadísticas", "estadisticas"))}${monthly(1)}<div class="chart-foot"><span class="key">Gasto registrado · UYU</span><span>Jun — Nov</span></div></section></div>
  <div class="grid duo"><section class="panel pad">${sectionTitle("Principales categorías", link("Ver todas", "estadisticas"))}<div class="eyebrow">Importe en UYU · % del mes</div>${catRows([12800, 9600, 3840], 28640)}</section><section class="panel pad">${sectionTitle("Presupuestos", link("Ver límites", "presupuestos"))}<div class="budget-feature">${gauge(106.67)}<div>${tag("Límite superado", "neg")}<h3>Transporte</h3><p class="figure">240 <span class="unit">UYU</span></p><p class="hero-note">por encima del límite mensual</p></div></div><div class="bottom-rule small-data muted">3 límites activos · 1 superado</div></section></div>
  <section class="panel table-panel">${sectionTitle("Gastos recientes", link("Ver historial", "historial"))}${expenseTable(expenses.filter((e) => e[4] === "UYU").slice(0, 3), false)}</section>`
  );
}
function historyPage() {
  return (
    header("Historial", "Consulta y edición de gastos registrados.") +
    `<div class="filters">${btn("Buscar por descripción", "search", "search")}${btn("Noviembre 2026", "date")}${btn("Filtros", "filters")}${btn("Limpiar", "", "ghost")}</div><section class="panel table-panel">${sectionTitle("Gastos de noviembre", `<span class="small-data muted">Fecha ↓</span>`)}${expenseTable(expenses, true)}<span class="pager">Cargar más gastos ${icon("down")}</span></section>`
  );
}
const budgets = [
  {
    cat: "Transporte",
    ic: "bus",
    used: 3840,
    limit: 3600,
    pct: 106.67,
    delta: 240,
    status: "Superado",
    color: "neg",
    ink: "var(--rosa)",
  },
  {
    cat: "Vivienda",
    ic: "house",
    used: 9600,
    limit: 10000,
    pct: 96,
    delta: 400,
    status: "Cerca del límite",
    color: "warn",
    ink: "var(--ambar)",
  },
  {
    cat: "Alimentación",
    ic: "cart",
    used: 12800,
    limit: 16000,
    pct: 80,
    delta: 3200,
    status: "Dentro del límite",
    color: "",
    ink: "#c0c6c0",
  },
];
function budgetTable() {
  const rows = budgets
    .map(
      (b) =>
        `<tr><td><div class="cat-name">${icon(b.ic)}${b.cat}</div><small class="${b.color}">${b.status}</small></td><td>${fmt(b.used)}</td><td>${fmt(b.limit)}</td><td>${b.pct > 100 ? "Exceso" : "Restan"}<br>${fmt(b.delta)}</td><td><div class="mono ${b.color}">${fmt(b.pct)}%</div><div class="track"><div class="fill" style="width:${Math.min(100, b.pct)}%;--ink:${b.ink}"></div></div></td><td>${icon("more")}</td></tr>`,
    )
    .join("");
  return `<table class="budget-table"><thead><tr><th>Categoría</th><th>Gastado</th><th>Límite</th><th>Margen</th><th>Uso</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}
function budgetPage() {
  return (
    header(
      "Presupuestos",
      "Límites mensuales por categoría · Noviembre de 2026",
      currency,
    ) +
    `<div class="budget-page"><section class="panel pad highlight">${sectionTitle("Mayor uso del límite", tag("Superado", "neg"))}<div class="gauge-wrap">${gauge(106.67)}<div><div class="eyebrow">Transporte</div><div class="figure">240 <span class="unit">UYU</span></div><p class="hero-note">de exceso este mes</p></div></div><p class="bottom-rule small-data muted">UYU 3.840 de 3.600</p></section><section class="panel table-panel">${sectionTitle("Mis límites", btn("Crear límite", "plus"))}${budgetTable()}<div class="budget-cards">${budgets
      .map(
        (b) =>
          `<article class="budget-card"><div class="spread"><div class="entry"><span class="tile">${icon(b.ic)}</span><div><h3>${b.cat}</h3><small class="${b.color}">${b.status}</small></div></div><div class="inline"><span class="mono ${b.color}">${fmt(b.pct)}%</span>${icon("more")}</div></div><div class="track"><div class="fill" style="width:${Math.min(100, b.pct)}%;--ink:${b.ink}"></div></div><dl class="facts">${[
            ["Gastado", b.used],
            ["Límite", b.limit],
            [b.pct > 100 ? "Exceso" : "Restante", b.delta],
          ]
            .map(([k, v]) => `<div><dt>${k}</dt><dd>${fmt(v)} UYU</dd></div>`)
            .join("")}</dl></article>`,
      )
      .join("")}</div></section></div>`
  );
}
function field(label, value, ic = "", extra = "") {
  return `<div class="field ${extra}"><span class="caption">${label}</span><div class="input">${value}${ic ? icon(ic) : ""}</div></div>`;
}
function formPage() {
  return (
    header("Nuevo gasto", "Registrá el importe, la fecha y la categoría.") +
    `<section class="form panel"><div class="form-section hero" style="min-height:144px">${engraving("etch")}<div class="spread"><span class="eyebrow">Importe del gasto</span>${currency}</div><div class="amount-field"><strong>1.280,00</strong><span class="unit">UYU</span></div></div><div class="form-section"><div class="fields">${field("Fecha", "23/11/2026", "date")}${field("Categoría", "Alimentación", "down")}${field("Subcategoría · opcional", "Supermercado", "down", "wide")}<div class="field wide"><span class="caption">Descripción · opcional</span><div class="input textarea">Compra semanal</div></div></div></div><div class="form-foot">${btn("Cancelar", "", "ghost")}${btn("Guardar gasto", "check", "primary")}</div></section>`
  );
}
const current = [75600, 55200, 25200, 12000],
  prior = [66000, 51600, 22800, 9600];
function comparison() {
  return `<table class="compare"><thead><tr>${["Categoría", "Actual", "Referencia", "Diferencia", "Variación"].map((s) => `<th>${s}</th>`).join("")}</tr></thead><tbody>${[0, 3, 2, 1].map((i) => `<tr><td>${categories[i]}</td><td data-label="Actual">${fmt(current[i])}</td><td data-label="Referencia">${fmt(prior[i])}</td><td data-label="Diferencia">+${fmt(current[i] - prior[i])}</td><td data-label="Variación">+${fmt(Math.round((current[i] / prior[i] - 1) * 10000) / 100)}%</td></tr>`).join("")}</tbody></table>`;
}
function annual() {
  return `<svg class="chart annual-line" viewBox="0 0 340 150" role="img" aria-label="Gasto anual en UYU. 2022: 221.600. 2023: sin registros. 2024: 264.000. 2025: 294.800. 2026 parcial: 276.640.">${[0, 1, 2].map((n) => `<path d="M36 ${111 - n * 45}h292" stroke="#353739" stroke-dasharray="2 4"/><text x="0" y="${114 - n * 45}" class="axis">${200 + n * 50}k</text>`).join("")}<path d="M180 53.4 249 25.68 318 42.02" stroke="#dedfd7" stroke-width="2" fill="none"/>${[
    [42, 91.56],
    [180, 53.4],
    [249, 25.68],
    [318, 42.02],
  ]
    .map(
      ([x, y]) =>
        `<circle cx="${x}" cy="${y}" r="4" stroke="#ededdf" fill="#232625" stroke-width="2"/>`,
    )
    .join(
      "",
    )}${[2022, 2023, 2024, 2025, 2026].map((y, i) => `<text x="${42 + i * 69}" y="135" class="axis" text-anchor="middle">${y}</text>`).join("")}</svg>`;
}
function statsPage() {
  return (
    header("Estadísticas", "Del 1 de mayo al 31 de octubre de 2026", currency) +
    `<div class="filters">${btn("May — Oct 2026", "date")}${btn("Todas las categorías", "categorias")}${btn("Filtros", "filters")}<span class="chip">Referencia · Nov 2025 — Abr 2026</span></div><div class="select-line"><div class="tab-set"><span class="tab on">Todas</span><span class="tab">Mis favoritos</span></div></div>
  <section class="panel pad metric-panel">${sectionTitle("Indicadores del período", fav)}<div class="metrics">${[
    ["Total gastado", "168.000", "UYU"],
    ["Cantidad", "144", "gastos"],
    ["Variación", "+12%", "vs. referencia"],
  ]
    .map(
      ([label, value, unit]) =>
        `<div><span class="eyebrow">${label}</span><div class="figure">${value} <span class="unit">${unit}</span></div></div>`,
    )
    .join("")}</div></section>
  <div class="grid even stats-duo"><section class="panel pad">${sectionTitle("Gastos por mes", fav)}${monthly(0)}<div class="chart-foot"><span class="key">Gasto mensual · UYU</span></div>${chartTable(
    ["Mes", "Cantidad", "UYU"],
    months
      .slice(0, 6)
      .map((m, i) => [m, [20, 24, 21, 26, 25, 28][i], fmt(monthValues[i])]),
    "Gasto por mes",
  )}</section><section class="panel pad">${sectionTitle("Gastos por categoría", fav)}<span class="eyebrow">Gastos · UYU · participación</span>${catRows(current, 168000, [70, 6, 52, 16])}</section></div>
  <section class="panel table-panel metric-panel">${sectionTitle("Comparación por categoría", fav)}${comparison()}</section>
  <div class="grid even stats-duo"><section class="panel pad">${sectionTitle("Evolución anual por categoría", fav)}<div class="spread"><div class="inline"><span class="square">${icon("back")}</span><span class="small-data">2022 — 2026</span><span class="square" style="opacity:.45">${icon("right")}</span></div>${tag("2026 parcial")}</div>${annual()}<div class="chart-foot"><span>Todas · UYU</span><span>2023 · Sin registros</span></div>${chartTable(
    ["Año", "Gasto registrado · UYU"],
    [
      ["2022", "221.600"],
      ["2023", "Sin registros"],
      ["2024", "264.000"],
      ["2025", "294.800"],
      ["2026 · parcial", "276.640"],
    ],
    "Gasto por año",
  )}</section><section class="panel pad">${sectionTitle("Resumen del período", fav)}<p style="font-size:22px;line-height:1.45;letter-spacing:-.035em">Alimentación concentró el <strong>45%</strong> del gasto registrado.</p><p class="bottom-rule soft">En estos seis meses registraste 144 gastos por UYU 168.000. El total aumentó UYU 18.000 frente al período de referencia.</p></section></div>`
  );
}
function sculpture() {
  // Tres recibos grabados sobre el mismo plano isométrico.
  const sheetPath =
    "M0 0h170v218l-8-4-8 4-8-4-8 4-8-4-8 4-8-4-8 4-8-4-8 4-8-4-8 4-8-4-8 4-8-4-8 4-8-4-8 4-8-4-8 4-10-4z";
  const lines = Array.from(
    { length: 13 },
    (_, i) =>
      `<path d="M16 ${68 + i * 10}h${i % 3 === 0 ? 36 : 62}m${i % 3 === 0 ? 63 : 37} 0h38" stroke="#565c59" stroke-width="${i % 4 === 0 ? 2 : 1}"/>`,
  ).join("");
  const sheets = [
    ["#272b29", "#626863", 42],
    ["#414743", "#888e86", 21],
    ["url(#paper)", "#c5c7bc", 0],
  ]
    .map(
      ([fill, stroke, d]) =>
        `<g transform="translate(${d} ${d * 1.22})"><path d="${sheetPath}" fill="${fill}" stroke="${stroke}"/></g>`,
    )
    .join("");
  return `<svg class="sculpture" viewBox="0 0 420 450" aria-hidden="true"><defs><linearGradient id="paper" x2=".7" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#d7d8cd"/><stop offset=".48" stop-color="#b9bdb3"/><stop offset="1" stop-color="#727a72"/></linearGradient></defs><g transform="matrix(1.15,-.46,.39,.93,54,150)">${sheets}<g fill="#434943"><path d="m17 39 10-20 7-3-10 20zm10 0 10-20 6 1-10 20zm9 1 10-20 4 3-7 16z"/><path d="M116 23h34v2h-34zm8 6h26v1h-26z"/></g><path d="M16 52h136m-136 142h136" stroke="#70756d" stroke-dasharray="2 3"/>${lines}</g></svg>`;
}
function accessPage() {
  return `<div class="login"><div class="login-art">${brand}${engraving("engraving")}${sculpture()}</div><div class="login-side"><section class="login-box"><span class="tile">${icon("lock")}</span><h1>Ingresá a tu espacio</h1><p class="soft">Usá tu cuenta de Google autorizada para consultar y registrar tus gastos.</p><span class="btn primary"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7 0-1.4-.2-2.1H12v4h5.4a4.7 4.7 0 0 1-2 3v2.6h3.2c1.9-1.8 3-4.4 3-7.5z"/><path fill="#34A853" d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.6a6 6 0 0 1-9-3.1H3v2.7A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.4H3a10 10 0 0 0 0 9.2z"/><path fill="#EA4335" d="M12 6.1c1.5 0 2.7.5 3.7 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-9 5.4l3.4 2.7a5.9 5.9 0 0 1 5.6-4z"/></svg>Continuar con Google</span><span class="panel-link">Recuperar acceso en Google ${icon("up")}</span></section></div></div>`;
}
function menu() {
  return `<aside class="sheet"><div class="sheet-body"><div class="spread"><h2>Mi espacio</h2><a href="${url(page)}" class="btn ghost">Cerrar</a></div>${["resumen", "estadisticas", "historial", "presupuestos"].map((id) => navItem(id, names[id])).join("")}<div class="navdiv"></div>${navItem("categorias", "Categorías")}${navItem("cuenta", "Mi cuenta")}</div></aside>`;
}
const pages = {
  resumen: overview,
  estadisticas: statsPage,
  historial: historyPage,
  presupuestos: budgetPage,
  gasto: formPage,
  login: accessPage,
};
document.title = names[page] + " · Pliegue · UI-01";
document.getElementById("lamina").innerHTML =
  page === "login"
    ? accessPage()
    : shell(pages[page]()) + (query.get("menu") === "1" ? menu() : "");
if (window.matchMedia("(max-width:620px)").matches) {
  for (const table of document.querySelectorAll(".chart-details"))
    table.open = true;
}
