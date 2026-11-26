const paths = {
  edit: 'M4 16 15 5l4 4-11 11-5 1z M13 7l4 4',
  check: 'm4 12 5 5L20 6',
  down: 'm6 9 6 6 6-6',
  upChevron: 'm6 15 6-6 6 6',
  resumen: 'M3 10 12 3l9 7v10h-6v-6H9v6H3z',
  historial: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6m-6 4h6',
  estadisticas: 'M4 20h16 M6 16v-4m6 4V5m6 11V9',
  presupuestos: 'M3 16a9 9 0 1 1 18 0 M12 15l4-6 M4 19h16',
  recurrentes: 'M17 2l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
  categorias: 'M3 4h8l10 10-7 7L3 10z M7 7h.01',
  cuenta: 'M4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  panel: 'M3 4h18v16H3z M9 4v16',
  menu: 'M3 6h18M3 12h18M3 18h18',
  up: 'M6 18 18 6M6 6h12v12',
  plus: 'M12 5v14M5 12h14',
  peso: 'M12 2v20 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  date: 'M3 6h18v15H3z M7 3v6m10-6v6M3 11h18',
  lock: 'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3',
  fold: 'M5 4h14v16H5z M8 8h8 M8 12h6',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 11v6m0-11v1',
  more: 'M4 12h1m6 0h1m6 0h1',
  filters: 'M3 6h9m4 0h5M3 17h4m4 0h10 M12 3v6m-5 5v6',
  search: 'M16 16l5 5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
};

export function Icon({ name }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
