import { useRef, useState } from 'react';
import { catalogToastMessage, useToast } from '../../app/toastContext.js';
import { Dialog } from '../../components/Dialog.jsx';
import { normalizeName } from '../expenses/draft.js';

export function CatalogEditor({ api, catalog, item, parent, onClose, onSaved, side = false }) {
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const input = useRef(null);
  const kind = parent ? 'subcategory' : 'category';
  const noun = parent ? 'subcategoría' : 'categoría';
  const title = (item ? 'Editar ' : 'Crear ') + noun;
  const normalized = normalizeName(name);
  const siblings = parent ? catalog.subcategories.filter((row) => row.category_id === parent.id) : catalog.categories;
  const existing = siblings.find((row) => row.id !== item?.id && row.name.toLowerCase() === normalized.toLowerCase());

  async function commit(target, patch) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const entry = target
        ? await api.rpc('update_category', { kind, id: target.id, patch })
        : await api.rpc('create_category', { name: patch.name, category_id: parent?.id ?? null });
      api.rememberCategory(entry);
      toast.success(catalogToastMessage(kind, target, patch));
      onSaved(entry);
    } catch (failure) {
      setError(failure.message);
      if (failure.code === 'DUPLICATE_NAME') api.refresh(true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!normalized) {
      setError('Ingresá un nombre de 1 a 80 caracteres.');
      input.current.focus();
      return;
    }
    if (existing) {
      setError('Ya existe una ' + noun + (existing.archived ? ' archivada' : '') + ' con ese nombre.');
      input.current.focus();
      return;
    }
    void commit(item, { name: normalized });
  }

  return (
    <Dialog title={title} side={side} busy={busy} onClose={onClose}>
      {parent && <p className="dialog-context">Categoría · {parent.name}</p>}
      <form onSubmit={submit} noValidate>
        <label className="field" htmlFor="catalog-name">Nombre
          <input ref={input} autoFocus id="catalog-name" autoComplete="off" value={name} disabled={busy}
            aria-invalid={Boolean(error)} aria-describedby={error ? 'catalog-error' : undefined}
            onChange={(event) => { setName(event.target.value); setError(''); }} />
        </label>
        {error && <p id="catalog-error" className="field-error" role="alert">{error}</p>}
        {error && existing?.archived && <button type="button" className="btn ghost" disabled={busy}
          onClick={() => commit(existing, { archived: false })}>Restaurar {existing.name}</button>}
        {item && <div className="archive-control">
          {!item.archived && <p>Los gastos conservan su clasificación al archivarla.</p>}
          <button type="button" className="btn ghost" disabled={busy}
            onClick={() => commit(item, { archived: !item.archived })}>
            {item.archived ? 'Restaurar' : 'Archivar'} {noun}
          </button>
        </div>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Guardando…' : item ? 'Guardar cambios' : title}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
