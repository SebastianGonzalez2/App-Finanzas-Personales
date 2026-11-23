import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import { currencies, validDate } from '../expenses/draft.js';
import { activeFilters, emptyFilters, isFiltered, NO_CHILD, periodOf, periods, rangeLabel } from './query.js';

function SearchBox({ value, onSearch }) {
  // Typing stays local; a short pause or Enter publishes the search to the URL.
  const [draft, setDraft] = useState({ text: value, source: value });
  if (draft.source !== value) setDraft({ text: draft.text.trim() === value ? draft.text : value, source: value });
  const pending = draft.text.trim() !== value;
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => onSearch(draft.text.trim()), 350);
    return () => clearTimeout(timer);
  }, [draft.text, pending, onSearch]);
  return (
    <form role="search" className="history-search" onSubmit={(event) => { event.preventDefault(); onSearch(draft.text.trim()); }}>
      <Icon name="search" />
      <label className="sr-only" htmlFor="history-q">Buscar por descripción</label>
      <input id="history-q" type="search" value={draft.text} maxLength={100} autoComplete="off" enterKeyHint="search"
        placeholder="Buscar por descripción" onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
    </form>
  );
}

function FilterPanel({ id, query, catalog, onApply, onClose }) {
  const [draft, setDraft] = useState(() => ({
    from: query.from, to: query.to, currency: query.currency, category: query.category, subcategory: query.subcategory,
  }));
  const [error, setError] = useState('');
  const first = useRef(null);
  useEffect(() => { first.current.focus(); }, []);
  const parent = catalog?.categories.find((row) => row.id === draft.category);
  const children = catalog?.subcategories.filter((row) => row.category_id === draft.category) ?? [];
  const set = (field) => (event) => {
    const value = event.target.value;
    setError('');
    setDraft((current) => field === 'category' ? { ...current, category: value, subcategory: '' } : { ...current, [field]: value });
  };
  function apply(event) {
    event.preventDefault();
    if ((draft.from && !validDate(draft.from)) || (draft.to && !validDate(draft.to))) {
      setError('Ingresá fechas válidas.');
      return;
    }
    if (draft.from && draft.to && draft.from > draft.to) {
      setError('La fecha inicial debe ser anterior o igual a la final.');
      return;
    }
    onApply(draft);
  }
  const archived = (row, parentRow) => row.archived || parentRow?.archived ? ' · Archivada' : '';
  return (
    <form id={id} className="history-panel" aria-label="Filtros del historial" onSubmit={apply} noValidate
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <div className="history-panel-grid">
        <div className="field">
          <label htmlFor="history-from">Desde</label>
          <input ref={first} id="history-from" type="date" min="0001-01-01" max="9999-12-31" value={draft.from}
            onChange={set('from')} aria-invalid={Boolean(error)} aria-describedby={error ? 'history-filter-error' : undefined} />
        </div>
        <div className="field">
          <label htmlFor="history-to">Hasta</label>
          <input id="history-to" type="date" min="0001-01-01" max="9999-12-31" value={draft.to}
            onChange={set('to')} aria-invalid={Boolean(error)} aria-describedby={error ? 'history-filter-error' : undefined} />
        </div>
        <div className="field">
          <label htmlFor="history-currency">Moneda</label>
          <select id="history-currency" value={draft.currency} onChange={set('currency')}>
            <option value="">Todas las monedas</option>
            {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="history-category">Categoría</label>
          <select id="history-category" value={draft.category} onChange={set('category')} disabled={!catalog}>
            <option value="">Todas las categorías</option>
            {catalog?.categories.map((row) => <option key={row.id} value={row.id}>{row.name}{archived(row)}</option>)}
          </select>
        </div>
        <div className="field field-wide">
          <label htmlFor="history-subcategory">Subcategoría</label>
          <select id="history-subcategory" value={draft.subcategory} onChange={set('subcategory')} disabled={!parent}>
            <option value="">{parent ? 'Todas las subcategorías' : 'Elegí primero una categoría'}</option>
            {parent && <option value={NO_CHILD}>Sin subcategoría</option>}
            {children.map((row) => <option key={row.id} value={row.id}>{row.name}{archived(row, parent)}</option>)}
          </select>
        </div>
      </div>
      {error && <p id="history-filter-error" className="field-error" role="alert">{error}</p>}
      <div className="history-panel-actions">
        <button type="button" className="btn ghost" onClick={() => { setError(''); setDraft({ ...emptyFilters }); }}>Quitar filtros</button>
        <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn primary">Aplicar</button>
      </div>
    </form>
  );
}

export function HistoryFilters({ query, today, catalog, onChange, onClear }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const toggle = useRef(null);
  const count = activeFilters(query);
  const period = periodOf(query, today);
  const options = periods(today);
  function close() {
    setOpen(false);
    toggle.current?.focus();
  }
  function choosePeriod(event) {
    const value = event.target.value;
    if (value === 'personalizado') { setOpen(true); return; }
    const chosen = options.find((option) => option.value === value);
    onChange({ from: chosen.from, to: chosen.to });
  }
  return (
    <div className="history-toolbar">
      <SearchBox value={query.q} onSearch={(q) => onChange({ q })} />
      <label className="btn history-period">
        <Icon name="date" />
        <span className="sr-only">Período</span>
        <span aria-hidden="true">{period ? period.label : rangeLabel(query)}</span>
        <select value={period?.value ?? 'personalizado'} onChange={choosePeriod}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          <option value="personalizado">{period ? 'Rango personalizado…' : rangeLabel(query)}</option>
        </select>
      </label>
      <button ref={toggle} type="button" className="btn history-filter-toggle" aria-expanded={open} aria-controls={open ? panel : undefined}
        onClick={() => setOpen(!open)}>
        <Icon name="filters" />Filtros{count > 0 && <span className="history-count" aria-label={count + (count === 1 ? ' activo' : ' activos')}>{count}</span>}
      </button>
      <button type="button" className="btn ghost" disabled={!isFiltered(query)} onClick={() => { setOpen(false); onClear(); }}>Limpiar</button>
      {open && <FilterPanel id={panel} query={query} catalog={catalog} onClose={close}
        onApply={(filters) => { onChange(filters); close(); }} />}
    </div>
  );
}
