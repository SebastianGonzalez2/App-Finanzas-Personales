import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import { validDate } from '../expenses/draft.js';
import { defaultReference, PERIODS, presetRange, rangeShort } from './query.js';

const archivedMark = (row, parent) => row.archived || parent?.archived ? ' · Archivada' : '';
const sameRange = (a, b) => Boolean(a && b) && a.from === b.from && a.to === b.to;

function FilterPanel({ id, query, catalog, onApply, onClose }) {
  const [draft, setDraft] = useState(() => ({
    from: query.range.from, to: query.range.to, category: query.category, subcategory: query.subcategory,
    refFrom: query.reference?.from ?? '', refTo: query.reference?.to ?? '',
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
  // Período y referencia del borrador: un preajuste intacto conserva su nombre en la URL.
  function resolve() {
    const range = { from: draft.from, to: draft.to };
    const period = sameRange(range, query.range) ? query.period : 'personalizado';
    return { period, range, fallback: defaultReference(period, range) };
  }
  function apply(event) {
    event.preventDefault();
    const dates = [draft.from, draft.to, draft.refFrom, draft.refTo];
    if (!draft.from || !draft.to || dates.some((value) => value && !validDate(value))) {
      setError('Ingresá fechas válidas para el período.');
      return;
    }
    if (draft.from > draft.to) { setError('La fecha inicial del período debe ser anterior o igual a la final.'); return; }
    if (Boolean(draft.refFrom) !== Boolean(draft.refTo) || (draft.refFrom && draft.refFrom > draft.refTo)) {
      setError('Completá las dos fechas de la referencia, la inicial anterior o igual a la final.');
      return;
    }
    const { period, range, fallback } = resolve();
    const chosen = draft.refFrom ? { from: draft.refFrom, to: draft.refTo } : fallback;
    onApply({
      period, range, reference: chosen, customReference: Boolean(chosen) && !sameRange(chosen, fallback),
      category: draft.category, subcategory: draft.subcategory, breakdown: '',
    });
  }
  function resetReference() {
    const { fallback } = resolve();
    setError('');
    setDraft((current) => ({ ...current, refFrom: fallback?.from ?? '', refTo: fallback?.to ?? '' }));
  }
  const field = (name, label, value, onChange, ref) => (
    <div className="field">
      <label htmlFor={id + name}>{label}</label>
      <input ref={ref} id={id + name} type="date" min="0001-01-01" max="9999-12-31" value={value} onChange={onChange}
        aria-invalid={Boolean(error)} aria-describedby={error ? id + 'error' : undefined} />
    </div>
  );
  return (
    <form id={id} className="history-panel stats-filter-panel" aria-label="Filtros de Estadísticas" onSubmit={apply} noValidate
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <fieldset>
        <legend className="eyebrow">Período</legend>
        <div className="history-panel-grid">
          {field('from', 'Desde', draft.from, set('from'), first)}
          {field('to', 'Hasta', draft.to, set('to'))}
          <div className="field">
            <label htmlFor={id + 'category'}>Categoría</label>
            <select id={id + 'category'} value={draft.category} onChange={set('category')} disabled={!catalog}>
              <option value="">Todas las categorías</option>
              {catalog?.categories.map((row) => <option key={row.id} value={row.id}>{row.name}{archivedMark(row)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={id + 'subcategory'}>Subcategoría</label>
            <select id={id + 'subcategory'} value={draft.subcategory} onChange={set('subcategory')} disabled={!parent}>
              <option value="">{parent ? 'Todas las subcategorías' : 'Elegí primero una categoría'}</option>
              {children.map((row) => <option key={row.id} value={row.id}>{row.name}{archivedMark(row, parent)}</option>)}
            </select>
          </div>
        </div>
      </fieldset>
      <fieldset>
        <legend className="eyebrow">Período de referencia</legend>
        <div className="history-panel-grid">
          {field('ref-from', 'Referencia desde', draft.refFrom, set('refFrom'))}
          {field('ref-to', 'Referencia hasta', draft.refTo, set('refTo'))}
        </div>
      </fieldset>
      {error && <p id={id + 'error'} className="field-error" role="alert">{error}</p>}
      <div className="history-panel-actions">
        <button type="button" className="btn ghost" onClick={resetReference}>Referencia predeterminada</button>
        <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn primary">Aplicar</button>
      </div>
    </form>
  );
}

export function StatsFilters({ query, today, catalog, onChange }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const toggle = useRef(null);
  const preset = PERIODS.find((option) => option.value === query.period);
  const parent = catalog?.categories.find((row) => row.id === query.category);
  const child = catalog?.subcategories.find((row) => row.id === query.subcategory);
  const active = Number(query.period === 'personalizado') + Number(Boolean(query.subcategory)) + Number(query.customReference);
  function close() {
    setOpen(false);
    toggle.current?.focus();
  }
  function choosePeriod(event) {
    const value = event.target.value;
    if (value === 'personalizado') { setOpen(true); return; }
    const range = presetRange(value, today);
    onChange({ period: value, range, reference: defaultReference(value, range), customReference: false });
  }
  const classification = parent ? parent.name + (child ? ' · ' + child.name : '') : 'Todas las categorías';
  return (
    <div className="filters stats-filters">
      <label className="btn history-period stats-select">
        <Icon name="date" />
        <span className="sr-only">Período: {preset ? preset.label + ', ' : ''}</span>
        <span className="select-text">{rangeShort(query.range)}</span>
        <select value={query.period} onChange={choosePeriod}>
          {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          <option value="personalizado">{query.period === 'personalizado' ? 'Rango personalizado' : 'Rango personalizado…'}</option>
        </select>
      </label>
      <label className="btn history-period stats-select">
        <Icon name="categorias" />
        <span className="sr-only">Categoría: </span>
        <span className="select-text">{classification}</span>
        <select value={query.category} disabled={!catalog}
          onChange={(event) => onChange({ category: event.target.value, subcategory: '', breakdown: '' })}>
          <option value="">Todas las categorías</option>
          {catalog?.categories.map((row) => <option key={row.id} value={row.id}>{row.name}{archivedMark(row)}</option>)}
        </select>
      </label>
      <button ref={toggle} type="button" className="btn history-filter-toggle" aria-expanded={open} aria-controls={open ? panel : undefined}
        onClick={() => setOpen(!open)}>
        <Icon name="filters" />Filtros{active > 0 && <span className="history-count" aria-label={active + (active === 1 ? ' activo' : ' activos')}>{active}</span>}
      </button>
      <span className="chip reference-chip">
        Referencia · {query.reference ? rangeShort(query.reference) : 'sin período anterior'}{query.customReference ? ' · personalizada' : ''}
      </span>
      {open && <FilterPanel id={panel} query={query} catalog={catalog} onClose={close}
        onApply={(patch) => { onChange(patch); close(); }} />}
    </div>
  );
}
