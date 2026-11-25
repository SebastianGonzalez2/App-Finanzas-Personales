import { useEffect, useId, useRef, useState } from 'react';
import { IsoDatePicker } from '../../components/DatePicker.jsx';
import { Icon } from '../../components/Icon.jsx';
import { SpringSelect } from '../../components/SpringSelect.jsx';
import { validDate } from '../expenses/draft.js';
import { defaultReference, PERIODS, presetRange, rangeShort } from './query.js';

const archivedMark = (row, parent) => row.archived || parent?.archived ? ' · Archivada' : '';
const sameRange = (a, b) => Boolean(a && b) && a.from === b.from && a.to === b.to;

function FilterPanel({ id, query, today, catalog, onApply, onClose }) {
  const [draft, setDraft] = useState(() => ({
    from: query.range.from, to: query.range.to, category: query.category, subcategory: query.subcategory,
    refFrom: query.reference?.from ?? '', refTo: query.reference?.to ?? '',
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
  const field = (name, label, value, onChange, { ref, clearable = false, placeholder = 'Elegí una fecha' } = {}) => (
    <div className="field">
      <label htmlFor={id + name}>{label}</label>
      <IsoDatePicker
        ref={ref}
        id={id + name}
        min="0001-01-01"
        max="9999-12-31"
        today={today}
        clearable={clearable}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? id + 'error' : undefined}
      />
    </div>
  );
  const categoryOptions = [
    { value: '', label: 'Todas las categorías' },
    ...(catalog?.categories ?? []).map((row) => ({ value: row.id, label: row.name + archivedMark(row) })),
  ];
  const subcategoryOptions = [
    { value: '', label: parent ? 'Todas las subcategorías' : 'Elegí primero una categoría' },
    ...children.map((row) => ({ value: row.id, label: row.name + archivedMark(row, parent) })),
  ];
  return (
    <form id={id} className="history-panel stats-filter-panel" aria-label="Filtros de Estadísticas" onSubmit={apply} noValidate
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <fieldset>
        <legend className="eyebrow">Período</legend>
        <div className="history-panel-grid">
          {field('from', 'Desde', draft.from, set('from'), { ref: first })}
          {field('to', 'Hasta', draft.to, set('to'))}
          <div className="field">
            <label htmlFor={id + 'category'}>Categoría</label>
            <SpringSelect
              id={id + 'category'}
              value={draft.category}
              disabled={!catalog}
              options={categoryOptions}
              onChange={set('category')}
            />
          </div>
          <div className="field">
            <label htmlFor={id + 'subcategory'}>Subcategoría</label>
            <SpringSelect
              id={id + 'subcategory'}
              value={draft.subcategory}
              disabled={!parent}
              options={subcategoryOptions}
              onChange={set('subcategory')}
            />
          </div>
        </div>
      </fieldset>
      <fieldset>
        <legend className="eyebrow">Período de referencia</legend>
        <div className="history-panel-grid">
          {field('ref-from', 'Referencia desde', draft.refFrom, set('refFrom'), { clearable: true, placeholder: 'Predeterminada' })}
          {field('ref-to', 'Referencia hasta', draft.refTo, set('refTo'), { clearable: true, placeholder: 'Predeterminada' })}
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
  function choosePeriod(value) {
    if (value === 'personalizado') { setOpen(true); return; }
    const range = presetRange(value, today);
    onChange({ period: value, range, reference: defaultReference(value, range), customReference: false });
  }
  const classification = parent ? parent.name + (child ? ' · ' + child.name : '') : 'Todas las categorías';
  const periodOptions = [
    ...PERIODS.map((option) => ({ value: option.value, label: option.label })),
    { value: 'personalizado', label: query.period === 'personalizado' ? 'Rango personalizado' : 'Rango personalizado…' },
  ];
  const categoryOptions = [
    { value: '', label: 'Todas las categorías' },
    ...(catalog?.categories ?? []).map((row) => ({ value: row.id, label: row.name + archivedMark(row) })),
  ];
  return (
    <div className="filters stats-filters">
      <SpringSelect
        variant="toolbar"
        className="history-period stats-select"
        icon={<Icon name="date" />}
        aria-label={`Período: ${preset ? preset.label + ', ' : ''}${rangeShort(query.range)}`}
        value={query.period}
        displayValue={rangeShort(query.range)}
        menuMinWidth={210}
        options={periodOptions}
        onChange={choosePeriod}
      />
      <SpringSelect
        variant="toolbar"
        className="history-period stats-select"
        icon={<Icon name="categorias" />}
        aria-label={`Categoría: ${classification}`}
        value={query.category}
        displayValue={classification}
        disabled={!catalog}
        menuMinWidth={210}
        options={categoryOptions}
        onChange={(value) => onChange({ category: value, subcategory: '', breakdown: '' })}
      />
      <button ref={toggle} type="button" className="btn history-filter-toggle" aria-expanded={open} aria-controls={open ? panel : undefined}
        onClick={() => setOpen(!open)}>
        <Icon name="filters" />Filtros{active > 0 && <span className="history-count" aria-label={active + (active === 1 ? ' activo' : ' activos')}>{active}</span>}
      </button>
      <span className="chip reference-chip">
        Referencia · {query.reference ? rangeShort(query.reference) : 'sin período anterior'}{query.customReference ? ' · personalizada' : ''}
      </span>
      {open && <FilterPanel id={panel} query={query} today={today} catalog={catalog} onClose={close}
        onApply={(patch) => { onChange(patch); close(); }} />}
    </div>
  );
}
