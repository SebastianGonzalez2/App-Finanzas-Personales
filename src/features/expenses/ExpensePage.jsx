import { useEffect, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router';
import { Dialog } from '../../components/Dialog.jsx';
import { Icon } from '../../components/Icon.jsx';
import { QueryState } from '../../components/QueryState.jsx';
import { useCatalog, useExpense, useFinance } from '../../lib/finance.js';
import { changeField, displayAmount, displayDate, expensePayload, newDraft, validateDraft } from './draft.js';
import { ExpenseFields } from './ExpenseFields.jsx';
import { isUncertain, reconcileWrite } from './reconcile.js';

export function ExpenseSummary({ expense }) {
  return <div className="expense-summary">
    <strong>{expense.currency} {displayAmount(expense.amount)}</strong>
    <span>{displayDate(expense.spent_on)} · {expense.category_name}{expense.subcategory_name && ' / ' + expense.subcategory_name}</span>
    {expense.description && <span>{expense.description}</span>}
  </div>;
}

export function ExpensePage({ preferences }) {
  const { id } = useParams();
  const api = useFinance();
  const catalog = useCatalog(api);
  const expense = useExpense(api, id);
  if (!catalog.data) return <QueryState query={catalog} loading="Cargando categorías…" />;
  if (id && !expense.data) return <QueryState query={expense} loading="Cargando gasto…" />;
  return <ExpenseForm key={id ?? 'new'} api={api} catalog={catalog.data} preferences={preferences} expense={expense.data} />;
}

function ExpenseForm({ api, catalog, preferences, expense }) {
  const { drafts } = api.memory;
  const key = expense?.id ?? 'new';
  const [form, setForm] = useState(() => {
    const saved = drafts.get(key);
    if (saved) return saved;
    const draft = newDraft(preferences, expense);
    return { draft, initial: draft, original: expense, pending: null };
  });
  const { draft, initial, original, pending } = form;
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inFlight = useRef(false);
  const finished = useRef(false);
  const mounted = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  // The history keeps its query string, so saving or deleting returns to the same consulta.
  const from = typeof location.state?.from === 'string' ? location.state.from : '';
  const origin = ['/', '/presupuestos', '/categorias', '/cuenta'].includes(from) ||
    /^\/(historial|estadisticas)(\?[^#]*)?$/.test(from) ? from : '/historial';
  const dirty = Boolean(pending) || Object.keys(initial).some((field) => initial[field] !== draft[field]);
  const blocker = useBlocker(() => !finished.current && (dirty || inFlight.current));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const preventClose = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventClose);
    return () => window.removeEventListener('beforeunload', preventClose);
  }, [dirty, busy]);

  function remember(next) {
    if (next.pending || Object.keys(next.initial).some((field) => next.initial[field] !== next.draft[field])) {
      drafts.set(key, next);
    } else {
      drafts.delete(key);
    }
    setForm(next);
  }
  function change(field, value) {
    if (inFlight.current || pending) return;
    remember({ ...form, draft: changeField(draft, field, value) });
    setErrors({});
    if (!conflict) setMessage('');
  }
  function finish(action, entry) {
    if (!mounted.current) return;
    api.rememberExpense(draft.id, action === 'delete' ? null : entry);
    drafts.delete(key);
    finished.current = true;
    const deleted = action === 'delete';
    const text = deleted ? 'Gasto eliminado' : action === 'update' ? 'Cambios guardados' : 'Gasto guardado';
    navigate(deleted && !origin.startsWith('/historial') ? '/historial' : origin, {
      replace: true, state: { notice: { owner: api.owner, text, id: deleted ? null : draft.id } },
    });
  }
  function showFieldErrors(next) {
    setErrors(next);
    requestAnimationFrame(() => document.getElementById(Object.keys(next)[0])?.focus());
  }

  async function write(operation, checkFirst = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    setConfirmDelete(false);
    remember({ ...form, pending: operation });
    let checking = checkFirst;
    try {
      if (checkFirst) {
        const confirmed = await reconcileWrite(api, operation);
        if (confirmed) { finish(operation.action, confirmed); return; }
      }
      checking = false;
      const response = await api.rpc(operation.action + '_expense', operation.args);
      const confirmed = operation.action === 'delete' ? response.deleted && response.id === draft.id
        : (response.expense ?? response).id === draft.id;
      if (!confirmed) throw new Error('No se pudo verificar la respuesta.');
      finish(operation.action, response.expense ?? response);
    } catch (error) {
      if (!mounted.current) return;
      if (error.code === 'STALE_VERSION') {
        remember({ ...form, pending: null });
        setConflict(true);
        setMessage(error.message);
      } else if (isUncertain(error) || (checking && error.code !== 'EXPENSE_NOT_FOUND')) {
        setMessage(operation.action === 'delete' ? 'No pudimos confirmar la eliminación.' : 'No pudimos confirmar el guardado.');
      } else {
        remember({ ...form, pending: null });
        setMessage(error.message);
        if (error.field) showFieldErrors({ [error.field]: error.message });
        if (error.field === 'category_id' || error.field === 'subcategory_id') api.refresh(true);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function submit(event) {
    event.preventDefault();
    if (inFlight.current || pending || conflict) return;
    const nextErrors = validateDraft(draft, catalog, original);
    if (Object.keys(nextErrors).length) { showFieldErrors(nextErrors); return; }
    const args = expensePayload(draft);
    if (original) args.version = original.version;
    void write({ action: original ? 'update' : 'create', args });
  }
  async function loadReview() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { setReview(await api.rpc('get_expense', { id: draft.id })); }
    catch (error) { setMessage(error.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function acceptReview(keepDraft) {
    const current = newDraft(preferences, review);
    remember({ original: review, initial: current, draft: keepDraft ? draft : current, pending: null });
    setReview(null);
    setConflict(false);
    setMessage('');
    setErrors({});
  }

  return (
    <>
      <form className="expense-card" onSubmit={submit} noValidate>
        <ExpenseFields api={api} catalog={catalog} draft={draft} original={original} change={change}
          errors={errors} locked={busy || Boolean(pending)} />
        {(message || (pending && !busy)) && <div className="form-feedback" role="alert">
          <p>{message || 'El envío está pendiente de comprobación.'}</p>
          {pending && <button type="button" className="btn ghost" onClick={() => write(pending, true)} disabled={busy}>Reintentar</button>}
          {conflict && <button type="button" className="btn ghost" disabled={busy} onClick={loadReview}>Revisar datos actuales</button>}
        </div>}
        <div className="form-actions">
          {original && <button type="button" className="btn ghost danger delete-trigger" disabled={busy || Boolean(pending) || conflict}
            onClick={() => setConfirmDelete(true)}>Eliminar gasto</button>}
          <button type="button" className="btn ghost" disabled={busy} onClick={() => navigate(origin)}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={busy || Boolean(pending) || conflict}>
            <Icon name="check" />{busy ? 'Guardando…' : original ? 'Guardar cambios' : 'Guardar gasto'}
          </button>
        </div>
      </form>
      {confirmDelete && <Dialog title="Eliminar gasto" onClose={() => setConfirmDelete(false)}>
        <ExpenseSummary expense={original} /><p>Se eliminará este gasto de tu registro.</p>
        <div className="dialog-actions">
          <button autoFocus type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>Cancelar</button>
          <button type="button" className="btn danger" onClick={() => write({ action: 'delete', args: { id: draft.id, version: original.version } })}>Eliminar gasto</button>
        </div>
      </Dialog>}
      {review && <Dialog title="Datos actuales del gasto" onClose={() => setReview(null)}>
        <ExpenseSummary expense={review} /><p>Elegí qué datos querés seguir editando.</p>
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={() => acceptReview(false)}>Usar datos actuales</button>
          <button autoFocus type="button" className="btn primary" onClick={() => acceptReview(true)}>Conservar mi borrador</button>
        </div>
      </Dialog>}
      {blocker.state === 'blocked' && <Dialog title="¿Salir del formulario?" onClose={() => blocker.reset()}>
        <p>{busy ? 'Esperá a que termine el envío.' : pending ? 'El resultado del envío aún está pendiente de comprobación.' : 'Tenés cambios sin guardar.'}</p>
        <div className="dialog-actions">
          <button autoFocus type="button" className="btn primary" onClick={() => blocker.reset()}>Seguir editando</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => {
            drafts.delete(key); finished.current = true; blocker.proceed();
          }}>Descartar cambios</button>
        </div>
      </Dialog>}
    </>
  );
}
