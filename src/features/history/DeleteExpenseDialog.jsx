import { useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog.jsx';
import { ExpenseSummary } from '../expenses/ExpensePage.jsx';
import { isUncertain, reconcileWrite } from '../expenses/reconcile.js';

// Same delete_expense contract and recovery as the edit form: a lost response is
// reconciled with get_expense before the frozen request is repeated.
export function DeleteExpenseDialog({ api, expense, onClose, onDeleted }) {
  const operation = useRef({ action: 'delete', args: { id: expense.id, version: expense.version } });
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const [closed, setClosed] = useState(false);

  function confirmed() {
    api.rememberExpense(expense.id, null);
    void api.reloadExpenses();
    onDeleted();
  }
  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    let checking = uncertain;
    try {
      if (checking) {
        const done = await reconcileWrite(api, operation.current);
        if (done) { confirmed(); return; }
      }
      checking = false;
      const response = await api.rpc('delete_expense', operation.current.args);
      if (!response.deleted || response.id !== expense.id) throw new Error('No se pudo verificar la respuesta.');
      confirmed();
    } catch (error) {
      if (isUncertain(error) || (checking && error.code !== 'STALE_VERSION')) {
        setUncertain(true);
        setMessage('No pudimos confirmar la eliminación.');
      } else {
        // Version conflicts and missing rows end this attempt; the list shows the current state.
        setUncertain(false);
        setClosed(true);
        setMessage(error.code === 'STALE_VERSION' ? 'El gasto cambió desde que lo abriste. Revisalo antes de eliminarlo.' : error.message);
        void api.reloadExpenses();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog title="Eliminar gasto" busy={busy} onClose={onClose}>
      <ExpenseSummary expense={expense} />
      <p>Se eliminará este gasto de tu registro.</p>
      {message && <p className="field-error" role="alert">{message}</p>}
      <div className="dialog-actions">
        <button autoFocus type="button" className="btn ghost" disabled={busy} onClick={onClose}>
          {closed ? 'Cerrar' : 'Cancelar'}
        </button>
        {!closed && <button type="button" className="btn danger" disabled={busy} onClick={remove}>
          {busy ? 'Eliminando…' : uncertain ? 'Reintentar' : 'Eliminar gasto'}
        </button>}
      </div>
    </Dialog>
  );
}
