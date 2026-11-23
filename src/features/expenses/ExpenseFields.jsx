import { useEffect, useRef, useState } from 'react';
import { currencies } from './draft.js';
import { CatalogEditor } from '../catalog/CatalogEditor.jsx';

function Field({ name, title, error, wide, children }) {
  return (
    <div className={'field' + (wide ? ' field-wide' : '')}>
      <label htmlFor={name}>{title}</label>
      {children}
      {error && <span id={name + '-error'} className="field-error">{error}</span>}
    </div>
  );
}

export function ExpenseFields({ draft, original, catalog, errors, change, locked, api }) {
  const [creator, setCreator] = useState(null);
  const amount = useRef(null);
  useEffect(() => { if (window.matchMedia('(min-width: 861px)').matches) amount.current.focus(); }, []);
  const parent = catalog.categories.find((row) => row.id === draft.category_id);
  const parents = catalog.categories.filter((row) => !row.archived || row.id === original?.category_id);
  const children = catalog.subcategories.filter((row) =>
    row.category_id === draft.category_id && ((!row.archived && !parent?.archived) || row.id === original?.subcategory_id));
  function props(name) {
    return {
      id: name, name, value: draft[name], 'aria-invalid': Boolean(errors[name]),
      'aria-describedby': errors[name] ? name + '-error' : undefined,
      onChange: (event) => change(name, event.target.value),
    };
  }
  function select(event) {
    const { name, value } = event.target;
    if (value === '__create__') setCreator(name);
    else change(name, value);
  }
  return (
    <>
      <fieldset disabled={locked} className="expense-fieldset">
        <div className="amount-hero">
          <div className="amount-head">
            <label className="eyebrow" htmlFor="amount">Importe del gasto</label>
            <div className="segments currencies" role="group" aria-label="Moneda">
              {currencies.map((currency) => <button type="button" key={currency} aria-pressed={currency === draft.currency}
                onClick={() => change('currency', currency)}>{currency}</button>)}
            </div>
          </div>
          <div className="amount-line">
            <input {...props('amount')} ref={amount} type="text" inputMode="decimal" autoComplete="off" required
              placeholder="0,00" size={Math.max(4, draft.amount.length)} />
            <span>{draft.currency}</span>
          </div>
          {errors.amount && <span id="amount-error" className="field-error">{errors.amount}</span>}
          {errors.currency && <span className="field-error">{errors.currency}</span>}
        </div>
        <div className="expense-grid">
          <Field name="spent_on" title="Fecha" error={errors.spent_on}>
            <input {...props('spent_on')} type="date" min="0001-01-01" max="9999-12-31" required />
          </Field>
          <Field name="category_id" title="Categoría" error={errors.category_id}>
            <select {...props('category_id')} required onChange={select}>
              <option value="">Elegí una categoría</option>
              {parents.map((row) => <option key={row.id} value={row.id}>{row.name}{row.archived && ' · Archivada'}</option>)}
              <option value="__create__">＋ Crear categoría</option>
            </select>
          </Field>
          <Field name="subcategory_id" title="Subcategoría · opcional" error={errors.subcategory_id} wide>
            <select {...props('subcategory_id')} onChange={select} disabled={!parent}>
              <option value="">Sin subcategoría</option>
              {children.map((row) => <option key={row.id} value={row.id}>
                {row.name}{(row.archived || parent.archived) && ' · Archivada'}
              </option>)}
              {parent && !parent.archived && <option value="__create__">＋ Crear subcategoría</option>}
            </select>
          </Field>
          <Field name="description" title="Descripción · opcional" error={errors.description} wide>
            <textarea {...props('description')} rows="2" />
          </Field>
        </div>
      </fieldset>
      {creator && <CatalogEditor api={api} catalog={catalog} parent={creator === 'subcategory_id' ? parent : null}
        onClose={() => setCreator(null)} onSaved={(entry) => { change(creator, entry.id); setCreator(null); }} />}
    </>
  );
}
