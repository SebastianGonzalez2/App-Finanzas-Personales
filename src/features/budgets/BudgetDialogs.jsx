import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.jsx';
import { Icon } from '../../components/Icon.jsx';
import { SpringSelect } from '../../components/SpringSelect.jsx';
import { currencies } from '../expenses/draft.js';
import { money } from '../stats/format.js';
import { budgetsKey, editableLimit, normalizeLimit, useBudgets } from './budgets.js';

const LIMIT_ERROR = 'Ingresá un límite mayor que cero, con hasta 12 enteros y 2 decimales.';
const UNCERTAIN = 'No pudimos confirmar el cambio. Revisá tu conexión y volvé a intentar.';

// Menú de cada límite (UI-01): «Editar límite» y «Retirar límite».
// Se monta en un portal con posición fija para no quedar recortado por el overflow del panel.
export function BudgetMenu({ budget, open, onToggle, onEdit, onRetire }) {
  const trigger = useRef(null);
  const menu = useRef(null);
  const id = 'budget-menu-' + budget.category_id;
  // The dialog returns focus to the element focused when it opens: the menu trigger, which stays.
  const choose = (action) => {
    trigger.current?.focus();
    onToggle(null);
    action(budget);
  };
  useLayoutEffect(() => {
    if (!open) return undefined;
    function place() {
      if (!trigger.current || !menu.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const box = menu.current.getBoundingClientRect();
      const gap = 6;
      const pad = 8;
      const left = Math.max(pad, Math.min(anchor.right - box.width, window.innerWidth - box.width - pad));
      const below = anchor.bottom + gap + box.height <= window.innerHeight - pad;
      const top = below ? anchor.bottom + gap : Math.max(pad, anchor.top - box.height - gap);
      menu.current.style.top = top + 'px';
      menu.current.style.left = left + 'px';
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector('button')?.focus();
    function outside(event) {
      if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) onToggle(null);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, onToggle]);
  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      onToggle(null);
      trigger.current?.focus();
    }
  };
  return (
    <div className="row-menu" onKeyDown={handleKeyDown}>
      <button ref={trigger} type="button" className="square row-menu-trigger" aria-label={'Acciones para el límite de ' + budget.category_name}
        title="Acciones" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => onToggle(open ? null : budget.category_id)}>
        <Icon name="more" />
      </button>
      {open && createPortal(
        <div ref={menu} id={id} className="row-menu-list floating" role="group"
          aria-label={'Acciones para el límite de ' + budget.category_name}
          onKeyDown={handleKeyDown}>
          <button type="button" onClick={() => choose(onEdit)}><Icon name="edit" />Editar límite</button>
          <button type="button" className="danger" onClick={() => choose(onRetire)}><Icon name="trash" />Retirar límite</button>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Crear o editar un límite (RF-024, RF-026). Al crear se propone la moneda activa y se
// detecta la combinación ya existente antes de enviar, con la opción de editarla.
export function BudgetFormDialog({ api, initial = null, catalog, currency: preferred, onClose, onDone }) {
  const cache = useQueryClient();
  const ids = useId();
  const [editing, setEditing] = useState(initial);
  const [category, setCategory] = useState(initial?.category_id ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? preferred);
  const [limit, setLimit] = useState(initial ? editableLimit(initial.monthly_limit) : '');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const uncertain = useRef(false);
  const limitInput = useRef(null);
  const categorySelect = useRef(null);
  const existing = useBudgets(api, currency, !editing);
  const taken = new Set(existing.data?.items.map((item) => item.category_id));
  const duplicate = !editing && category ? existing.data?.items.find((item) => item.category_id === category) : null;
  const active = catalog.categories.filter((row) => !row.archived);
  const archived = (id) => catalog.categories.find((row) => row.id === id)?.archived;

  function edit(item) {
    setEditing(item);
    setCategory(item.category_id);
    setCurrency(item.currency);
    setLimit(editableLimit(item.monthly_limit));
    setErrors({});
    setMessage('');
    requestAnimationFrame(() => limitInput.current?.focus());
  }

  function finish(result, created) {
    void cache.invalidateQueries({ queryKey: budgetsKey(api.owner) });
    const hidden = result.currency !== preferred ? ` Elegí ${result.currency} arriba para verlo en la lista.` : '';
    onDone(`${created ? 'Límite creado' : 'Límite actualizado'}: ${result.category_name} · ${result.currency} ${money(result.monthly_limit)}.${hidden}`);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const amount = normalizeLimit(limit);
    const found = {};
    if (!editing && !category) found.category_id = 'Elegí una categoría.';
    if (!amount) found.monthly_limit = LIMIT_ERROR;
    setErrors(found);
    if (found.category_id) { categorySelect.current?.focus(); return; }
    if (found.monthly_limit) { limitInput.current?.focus(); return; }
    if (duplicate) return;
    const args = { category_id: editing?.category_id ?? category, currency: editing?.currency ?? currency, monthly_limit: amount };
    setBusy(true);
    setMessage('');
    try {
      const result = await api.rpc(editing ? 'update_budget' : 'create_budget', args);
      uncertain.current = false;
      finish(result, !editing);
    } catch (error) {
      if (!editing && error.code === 'DUPLICATE_BUDGET') {
        // A previous attempt whose answer was lost may have created this very limit.
        const fresh = (await existing.refetch()).data?.items.find((item) => item.category_id === args.category_id);
        if (uncertain.current && fresh?.monthly_limit === amount) { uncertain.current = false; finish(fresh, true); return; }
        uncertain.current = false;
        if (!fresh) setMessage(error.message);
      } else if (error.code === 'BUDGET_NOT_FOUND') {
        uncertain.current = false;
        setMessage('Este límite ya no existe. Cerrá el formulario para ver la lista actualizada.');
        void cache.invalidateQueries({ queryKey: budgetsKey(api.owner) });
      } else if (error.field && error.code) {
        uncertain.current = false;
        setErrors({ [error.field]: error.message });
      } else {
        uncertain.current = true;
        setMessage(error.status === 401 || error.status === 403 ? error.message : UNCERTAIN);
      }
    } finally {
      setBusy(false);
    }
  }

  const categoryName = editing?.category_name ?? catalog.categories.find((row) => row.id === category)?.name;
  return (
    <Dialog title={editing ? 'Editar límite' : 'Crear límite'} busy={busy} onClose={onClose}>
      <form className="budget-form" onSubmit={submit} noValidate>
        {editing ? (
          <dl className="budget-facts">
            <div><dt>Categoría</dt><dd>{editing.category_name}{archived(editing.category_id) && <small className="archived-mark">Archivada</small>}</dd></div>
            <div><dt>Moneda</dt><dd>{editing.currency}</dd></div>
            <div><dt>Consumido este mes</dt><dd className="money">{editing.currency} {money(editing.spent)}</dd></div>
          </dl>
        ) : <>
          <div className="field">
            <label htmlFor={ids + '-category-select'}>Categoría</label>
            <SpringSelect
              ref={categorySelect}
              id={ids + '-category-select'}
              value={category}
              required
              placeholder="Elegí una categoría"
              aria-invalid={Boolean(errors.category_id || duplicate)}
              aria-describedby={ids + '-category'}
              options={[
                { value: '', label: 'Elegí una categoría' },
                ...active.map((row) => ({
                  value: row.id,
                  label: row.name + (taken.has(row.id) ? ` · ya tiene límite en ${currency}` : ''),
                })),
              ]}
              onChange={(next) => { setCategory(next); setErrors({}); setMessage(''); }}
            />
            <span id={ids + '-category'} className="field-help">Las subcategorías se suman a su categoría. Las archivadas no admiten límites nuevos.</span>
            {errors.category_id && <span className="field-error">{errors.category_id}</span>}
          </div>
          <div className="field">
            <span id={ids + '-currency'}>Moneda</span>
            <div className="segments currencies" role="group" aria-labelledby={ids + '-currency'}>
              {currencies.map((code) => <button type="button" key={code} aria-pressed={code === currency}
                onClick={() => { setCurrency(code); setErrors({}); setMessage(''); }}>{code}</button>)}
            </div>
          </div>
        </>}
        <label className="field">
          Límite mensual
          <span className="limit-input">
            <input ref={limitInput} inputMode="decimal" autoComplete="off" placeholder="0,00" value={limit} autoFocus={Boolean(editing)}
              aria-invalid={Boolean(errors.monthly_limit)} aria-describedby={ids + '-limit'}
              onChange={(event) => { setLimit(event.target.value); setErrors((current) => ({ ...current, monthly_limit: undefined })); }} />
            <span aria-hidden="true">{editing?.currency ?? currency}</span>
          </span>
          <span id={ids + '-limit'} className="field-help">
            Cuenta los gastos registrados en {editing?.currency ?? currency} durante cada mes. Es un límite de seguimiento: no reserva dinero.
          </span>
          {errors.monthly_limit && <span className="field-error">{errors.monthly_limit}</span>}
        </label>
        {duplicate && <div className="budget-duplicate" role="alert">
          <p>{categoryName} ya tiene un límite de {currency} {money(duplicate.monthly_limit)}. Solo puede haber uno por categoría y moneda.</p>
          <button type="button" className="btn ghost" onClick={() => edit(duplicate)}><Icon name="edit" />Editar ese límite</button>
        </div>}
        {message && <p className="field-error" role="alert">{message}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={busy || Boolean(duplicate)}>
            {busy ? 'Guardando…' : editing ? 'Guardar límite' : 'Crear límite'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// Retirar solo el límite (RF-026): nunca modifica ni elimina gastos.
export function RetireBudgetDialog({ api, budget, onClose, onDone }) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function retire() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await api.rpc('delete_budget', { category_id: budget.category_id, currency: budget.currency });
      done();
    } catch (error) {
      // Already removed (also after a lost answer): the outcome the person asked for.
      if (error.code === 'BUDGET_NOT_FOUND') done();
      else setMessage(error.status === 401 || error.status === 403 ? error.message : UNCERTAIN);
    } finally {
      setBusy(false);
    }
  }
  function done() {
    void cache.invalidateQueries({ queryKey: budgetsKey(api.owner) });
    onDone(`Límite retirado: ${budget.category_name} · ${budget.currency}. Los gastos se conservan.`);
  }
  return (
    <Dialog title="Retirar límite" busy={busy} onClose={onClose}>
      <div className="expense-summary">
        <strong>{budget.category_name} · {budget.currency}</strong>
        <span>Límite mensual {budget.currency} {money(budget.monthly_limit)} · consumido este mes {budget.currency} {money(budget.spent)}</span>
      </div>
      <p>Se retirará solo este límite. Los gastos registrados y las estadísticas se conservan.</p>
      {message && <p className="field-error" role="alert">{message}</p>}
      <div className="dialog-actions">
        <button autoFocus type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="button" className="btn danger" disabled={busy} onClick={retire}>{busy ? 'Retirando…' : 'Retirar límite'}</button>
      </div>
    </Dialog>
  );
}
