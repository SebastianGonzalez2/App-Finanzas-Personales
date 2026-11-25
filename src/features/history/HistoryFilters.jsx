import { useEffect, useId, useRef, useState } from 'react';
import { IsoDatePicker } from '../../components/DatePicker.jsx';
import { Icon } from '../../components/Icon.jsx';
import { SpringSelect } from '../../components/SpringSelect.jsx';
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

function FilterPanel({ id, query, today, catalog, onApply, onClose }) {
  const [draft, setDraft] = useState(() => ({
    from: query.from, to: query.to, currency: query.currency, category: query.category, subcategory: query.subcategory,
  }));
  const [error, setError] = useState('');
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  const parent = catalog?.categories.find((row) => row.id === draft.category);
  const children = catalog?.subcategories.filter((row) => row.category_id === draft.category) ?? [];
  const set = (field) => (value) => {
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
  const currencyOptions = [
    { value: '', label: 'Todas las monedas' },
    ...currencies.map((code) => ({ value: code, label: code })),
  ];
  const categoryOptions = [
    { value: '', label: 'Todas las categorías' },
    ...(catalog?.categories ?? []).map((row) => ({ value: row.id, label: row.name + archived(row) })),
  ];
  const subcategoryOptions = [
    { value: '', label: parent ? 'Todas las subcategorías' : 'Elegí primero una categoría' },
    ...(parent ? [{ value: NO_CHILD, label: 'Sin subcategoría' }] : []),
    ...children.map((row) => ({ value: row.id, label: row.name + archived(row, parent) })),
  ];
  return (
    <form id={id} className="history-panel" aria-label="Filtros del historial" onSubmit={apply} noValidate
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <div className="history-panel-grid">
        <div className="field">
          <label htmlFor="history-from">Desde</label>
          <IsoDatePicker
            ref={first}
            id="history-from"
            min="0001-01-01"
            max="9999-12-31"
            today={today}
            clearable
            placeholder="Sin límite"
            value={draft.from}
            onChange={set('from')}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'history-filter-error' : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor="history-to">Hasta</label>
          <IsoDatePicker
            id="history-to"
            min="0001-01-01"
            max="9999-12-31"
            today={today}
            clearable
            placeholder="Sin límite"
            value={draft.to}
            onChange={set('to')}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'history-filter-error' : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor="history-currency">Moneda</label>
          <SpringSelect
            id="history-currency"
            value={draft.currency}
            options={currencyOptions}
            onChange={set('currency')}
          />
        </div>
        <div className="field">
          <label htmlFor="history-category">Categoría</label>
          <SpringSelect
            id="history-category"
            value={draft.category}
            disabled={!catalog}
            options={categoryOptions}
            onChange={set('category')}
          />
        </div>
        <div className="field field-wide">
          <label htmlFor="history-subcategory">Subcategoría</label>
          <SpringSelect
            id="history-subcategory"
            value={draft.subcategory}
            disabled={!parent}
            options={subcategoryOptions}
            onChange={set('subcategory')}
          />
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
  function choosePeriod(value) {
    if (value === 'personalizado') { setOpen(true); return; }
    const chosen = options.find((option) => option.value === value);
    onChange({ from: chosen.from, to: chosen.to });
  }
  const periodLabel = period ? period.label : rangeLabel(query);
  const periodOptions = [
    ...options.map((option) => ({ value: option.value, label: option.label })),
    { value: 'personalizado', label: period ? 'Rango personalizado…' : rangeLabel(query) },
  ];
  return (
    <div className="history-toolbar">
      <SearchBox value={query.q} onSearch={(q) => onChange({ q })} />
      <SpringSelect
        variant="toolbar"
        className="history-period"
        icon={<Icon name="date" />}
        aria-label={`Período: ${periodLabel}`}
        value={period?.value ?? 'personalizado'}
        displayValue={periodLabel}
        menuMinWidth={210}
        options={periodOptions}
        onChange={choosePeriod}
      />
      <button ref={toggle} type="button" className="btn history-filter-toggle" aria-expanded={open} aria-controls={open ? panel : undefined}
        onClick={() => setOpen(!open)}>
        <Icon name="filters" />Filtros{count > 0 && <span className="history-count" aria-label={count + (count === 1 ? ' activo' : ' activos')}>{count}</span>}
      </button>
      <button type="button" className="btn ghost" disabled={!isFiltered(query)} onClick={() => { setOpen(false); onClear(); }}>Limpiar</button>
      {open && <FilterPanel id={panel} query={query} today={today} catalog={catalog} onClose={close}
        onApply={(filters) => { onChange(filters); close(); }} />}
    </div>
  );
}
