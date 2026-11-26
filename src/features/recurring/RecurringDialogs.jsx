import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.jsx';
import { Icon } from '../../components/Icon.jsx';
import { SpringSelect } from '../../components/SpringSelect.jsx';
import { currencies, displayDate, normalizeAmount } from '../expenses/draft.js';
import { money } from '../stats/format.js';
import {
  computePreviewNextDate,
  editableRecurringAmount,
  normalizeRecurringName,
  recurringKey,
  validateRecurringDraft,
} from './recurring.js';

const UNCERTAIN = 'No pudimos confirmar el cambio. Revisá tu conexión y volvé a intentar.';

const DAY_OPTIONS = Array.from({ length: 31 }, (_, idx) => {
  const day = idx + 1;
  return {
    value: String(day),
    label: day >= 29 ? `Día ${day} (último día si el mes tiene menos)` : `Día ${day}`,
  };
});

export function RecurringMenu({ item, open, onToggle, onEdit, onDelete }) {
  const trigger = useRef(null);
  const menu = useRef(null);
  const id = 'recurring-menu-' + item.id;

  const choose = (action) => {
    trigger.current?.focus();
    onToggle(null);
    action(item);
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
      <button
        ref={trigger}
        type="button"
        className="square row-menu-trigger"
        aria-label={`Acciones para ${item.name}`}
        title="Acciones"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => onToggle(open ? null : item.id)}
      >
        <Icon name="more" />
      </button>
      {open && createPortal(
        <div
          ref={menu}
          id={id}
          className="row-menu-list floating"
          role="group"
          aria-label={`Acciones para ${item.name}`}
          onKeyDown={handleKeyDown}
        >
          <button type="button" onClick={() => choose(onEdit)}>
            <Icon name="edit" />Editar
          </button>
          <button type="button" className="danger" onClick={() => choose(onDelete)}>
            <Icon name="trash" />Eliminar
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function RecurringFormDialog({ api, initial = null, catalog, currency: preferred, today, onClose, onDone }) {
  const cache = useQueryClient();
  const ids = useId();
  const editing = Boolean(initial);
  const defaultDay = String(Number(today.slice(8, 10)) || 1);

  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial ? editableRecurringAmount(initial.amount) : '');
  const [currency, setCurrency] = useState(initial?.currency ?? preferred);
  const [category, setCategory] = useState(initial?.category_id ?? '');
  const [subcategory, setSubcategory] = useState(initial?.subcategory_id ?? '');
  const [billingDay, setBillingDay] = useState(initial ? String(initial.billing_day) : defaultDay);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const nameInput = useRef(null);
  const amountInput = useRef(null);
  const categorySelect = useRef(null);
  const subcategorySelect = useRef(null);
  const daySelect = useRef(null);

  const selectedParent = catalog.categories.find((row) => row.id === category);
  const parents = catalog.categories.filter((row) => !row.archived || row.id === initial?.category_id);
  const children = catalog.subcategories.filter((row) => (
    row.category_id === category
    && ((!row.archived && !selectedParent?.archived) || row.id === initial?.subcategory_id)
  ));

  const previewDate = computePreviewNextDate(billingDay, today);
  const hasArchivedSelection = Boolean(
    selectedParent?.archived
    || (subcategory && catalog.subcategories.find((row) => row.id === subcategory)?.archived),
  );

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    const draft = {
      name,
      amount,
      currency,
      category_id: category,
      subcategory_id: subcategory,
      billing_day: billingDay,
    };
    const found = validateRecurringDraft(draft, catalog, initial);
    if (editing && (selectedParent?.archived || (subcategory && catalog.subcategories.find((row) => row.id === subcategory)?.archived))) {
      if (selectedParent?.archived) found.category_id = 'Elegí una categoría activa para reanudar el registro automático.';
      else found.subcategory_id = 'Elegí una subcategoría activa o quitá la subcategoría archivada.';
    }
    setErrors(found);
    if (found.name) { nameInput.current?.focus(); return; }
    if (found.amount) { amountInput.current?.focus(); return; }
    if (found.category_id) { categorySelect.current?.focus(); return; }
    if (found.subcategory_id) { subcategorySelect.current?.focus(); return; }
    if (found.billing_day) { daySelect.current?.focus(); return; }

    const args = {
      name: normalizeRecurringName(name),
      amount: normalizeAmount(amount),
      currency,
      category_id: category,
      subcategory_id: subcategory || null,
      billing_day: Number(billingDay),
    };

    setBusy(true);
    setMessage('');
    try {
      const result = editing
        ? await api.rpc('update_recurring_payment', { id: initial.id, version: initial.version, ...args })
        : await api.rpc('create_recurring_payment', args);
      void cache.invalidateQueries({ queryKey: recurringKey(api.owner) });
      onDone(
        `${editing ? 'Pago recurrente actualizado' : 'Pago recurrente creado'}: ${result.name} · ${result.currency} ${money(result.amount)}.`,
      );
    } catch (error) {
      if (error.code === 'RECURRING_NOT_FOUND') {
        setMessage('Este pago recurrente ya no existe. Cerrá el formulario para ver la lista actualizada.');
        void cache.invalidateQueries({ queryKey: recurringKey(api.owner) });
      } else if (error.code === 'STALE_VERSION') {
        setMessage('Este pago recurrente cambió en otro lugar. Cerrá y volvé a abrirlo.');
        void cache.invalidateQueries({ queryKey: recurringKey(api.owner) });
      } else if (error.field && error.code) {
        setErrors({ [error.field]: error.message });
      } else {
        setMessage(error.status === 401 || error.status === 403 ? error.message : UNCERTAIN);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={editing ? 'Editar pago recurrente' : 'Nuevo pago recurrente'} busy={busy} onClose={onClose}>
      <form className="recurring-form" onSubmit={submit} noValidate>
        {editing && initial.needs_attention && (
          <div className="recurring-alert" role="alert">
            La categoría o subcategoría asociada está archivada. Elegí una clasificación activa para que los próximos cobros se registren sin bloqueos.
          </div>
        )}

        <div className="field">
          <label htmlFor={ids + '-name'}>Nombre o descripción</label>
          <input
            ref={nameInput}
            id={ids + '-name'}
            type="text"
            autoFocus={!editing}
            autoComplete="off"
            maxLength={120}
            placeholder="Ej.: Spotify, Alquiler, Internet"
            value={name}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? ids + '-name-err' : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setErrors((current) => ({ ...current, name: undefined }));
            }}
          />
          {errors.name && <span id={ids + '-name-err'} className="field-error">{errors.name}</span>}
        </div>

        <div className="recurring-pair">
          <label className="field">
            Importe
            <span className="limit-input">
              <input
                ref={amountInput}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={amount}
                autoFocus={editing && !hasArchivedSelection}
                aria-invalid={Boolean(errors.amount)}
                aria-describedby={errors.amount ? ids + '-amount-err' : undefined}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setErrors((current) => ({ ...current, amount: undefined }));
                }}
              />
              <span aria-hidden="true">{currency}</span>
            </span>
            {errors.amount && <span id={ids + '-amount-err'} className="field-error">{errors.amount}</span>}
          </label>

          <div className="field">
            <span id={ids + '-currency'}>Moneda</span>
            <div className="segments currencies" role="group" aria-labelledby={ids + '-currency'}>
              {currencies.map((code) => (
                <button
                  type="button"
                  key={code}
                  aria-pressed={code === currency}
                  onClick={() => {
                    setCurrency(code);
                    setErrors((current) => ({ ...current, currency: undefined }));
                  }}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="recurring-pair">
          <div className="field">
            <label htmlFor={ids + '-category'}>Categoría</label>
            <SpringSelect
              ref={categorySelect}
              id={ids + '-category'}
              value={category}
              required
              placeholder="Elegí una categoría"
              aria-invalid={Boolean(errors.category_id)}
              aria-describedby={errors.category_id ? ids + '-category-err' : undefined}
              options={[
                { value: '', label: 'Elegí una categoría' },
                ...parents.map((row) => ({
                  value: row.id,
                  label: row.name + (row.archived ? ' · Archivada' : ''),
                })),
              ]}
              onChange={(next) => {
                setCategory(next);
                setSubcategory('');
                setErrors((current) => ({ ...current, category_id: undefined, subcategory_id: undefined }));
              }}
            />
            {errors.category_id && <span id={ids + '-category-err'} className="field-error">{errors.category_id}</span>}
          </div>

          <div className="field">
            <label htmlFor={ids + '-subcategory'}>Subcategoría · opcional</label>
            <SpringSelect
              ref={subcategorySelect}
              id={ids + '-subcategory'}
              value={subcategory}
              disabled={!selectedParent}
              placeholder="Sin subcategoría"
              aria-invalid={Boolean(errors.subcategory_id)}
              aria-describedby={errors.subcategory_id ? ids + '-sub-err' : undefined}
              options={[
                { value: '', label: 'Sin subcategoría' },
                ...children.map((row) => ({
                  value: row.id,
                  label: row.name + ((row.archived || selectedParent?.archived) ? ' · Archivada' : ''),
                })),
              ]}
              onChange={(next) => {
                setSubcategory(next);
                setErrors((current) => ({ ...current, subcategory_id: undefined }));
              }}
            />
            {errors.subcategory_id && <span id={ids + '-sub-err'} className="field-error">{errors.subcategory_id}</span>}
          </div>
        </div>

        <div className="field">
          <label htmlFor={ids + '-day'}>Día de cobro mensual</label>
          <SpringSelect
            ref={daySelect}
            id={ids + '-day'}
            value={billingDay}
            required
            aria-invalid={Boolean(errors.billing_day)}
            aria-describedby={ids + '-day-help'}
            options={DAY_OPTIONS}
            onChange={(next) => {
              setBillingDay(next);
              setErrors((current) => ({ ...current, billing_day: undefined }));
            }}
          />
          <span id={ids + '-day-help'} className="field-help">
            Frecuencia mensual. Si el día elegido no existe en un mes, se registra el último día de ese mes.
            {previewDate && (
              <> Próximo registro estimado: <strong>{displayDate(previewDate)}</strong>.</>
            )}
          </span>
          {errors.billing_day && <span className="field-error">{errors.billing_day}</span>}
        </div>

        {editing && (
          <p className="field-help">
            Los cambios aplican únicamente a los registros futuros; los gastos ya generados en el Historial no se modifican.
          </p>
        )}

        {message && <p className="field-error" role="alert">{message}</p>}

        <div className="dialog-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar pago recurrente'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteRecurringDialog({ api, item, onClose, onDone }) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  function finish() {
    void cache.invalidateQueries({ queryKey: recurringKey(api.owner) });
    onDone(`Pago recurrente eliminado: ${item.name}. Los gastos históricos se conservan.`);
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await api.rpc('delete_recurring_payment', { id: item.id, version: item.version });
      finish();
    } catch (error) {
      if (error.code === 'RECURRING_NOT_FOUND') {
        finish();
      } else {
        setMessage(error.status === 401 || error.status === 403 ? error.message : UNCERTAIN);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Eliminar pago recurrente" busy={busy} onClose={onClose}>
      <div className="expense-summary">
        <strong>{item.name} · {item.currency} {money(item.amount)}</strong>
        <span>
          {item.category_name}
          {item.subcategory_name ? ` · ${item.subcategory_name}` : ''} · Día {item.billing_day} de cada mes
        </span>
      </div>
      <p>Se cancelarán los próximos registros automáticos. Los gastos que ya se registraron en el Historial se conservan intactos.</p>
      {message && <p className="field-error" role="alert">{message}</p>}
      <div className="dialog-actions">
        <button autoFocus type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="button" className="btn danger" disabled={busy} onClick={remove}>
          {busy ? 'Eliminando…' : 'Eliminar pago recurrente'}
        </button>
      </div>
    </Dialog>
  );
}
