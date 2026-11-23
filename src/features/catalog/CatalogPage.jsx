import { useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import { QueryState } from '../../components/QueryState.jsx';
import { useCatalog, useFinance } from '../../lib/finance.js';
import { CatalogEditor } from './CatalogEditor.jsx';

function EditButton({ item, onClick }) {
  return <button type="button" className="square item-edit" aria-label={'Editar ' + item.name}
    title={'Editar ' + item.name} onClick={onClick}><Icon name="edit" /></button>;
}

export function CatalogPage() {
  const api = useFinance();
  const query = useCatalog(api);
  const [archived, setArchived] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [editor, setEditor] = useState(null);
  const [notice, setNotice] = useState('');
  if (!query.data) return <QueryState query={query} loading="Cargando categorías…" />;
  const { categories, subcategories } = query.data;
  const groups = categories.map((parent) => {
    const children = subcategories.filter((item) => item.category_id === parent.id && (item.archived || parent.archived) === archived);
    return { parent, children };
  }).filter(({ parent, children }) => parent.archived === archived || (archived && children.length > 0));

  return (
    <section className="catalog" aria-label="Catálogo personal">
      <div className="catalog-toolbar">
        <div className="segments" aria-label="Estado de las categorías" role="group">
          {[false, true].map((flag) => <button key={String(flag)} type="button" aria-pressed={archived === flag}
            onClick={() => { setArchived(flag); setExpanded(null); }}>{flag ? 'Archivadas' : 'Activas'}</button>)}
        </div>
        <button type="button" className="btn ghost" onClick={() => setEditor({})}><Icon name="plus" />Crear categoría</button>
      </div>
      {notice && <p className="feedback" role="status">{notice}</p>}
      {query.isRefetchError && <QueryState query={query} />}
      {groups.length === 0 ? <p className="query-state">{archived ? 'No tenés categorías archivadas.' : 'No tenés categorías activas.'}</p>
        : <ul className="category-tree">{groups.map(({ parent, children }) => (
          <li key={parent.id}>
            <div className="category-row">
              <button type="button" className="tree-toggle" aria-expanded={expanded === parent.id}
                onClick={() => setExpanded(expanded === parent.id ? null : parent.id)}>
                <span className="tile"><Icon name="categorias" /></span>
                <span className="tree-name">{parent.name}{parent.archived && <small>Archivada</small>}</span>
                <Icon name={expanded === parent.id ? 'upChevron' : 'down'} />
              </button>
              <EditButton item={parent} onClick={() => setEditor({ item: parent })} />
            </div>
            {expanded === parent.id && <div className="category-children">
              <ul>{children.map((child) => <li key={child.id}>
                <span>{child.name}{(child.archived || parent.archived) && <small>Archivada</small>}</span>
                <EditButton item={child} onClick={() => setEditor({ item: child, parent })} />
              </li>)}</ul>
              {!children.length && <p className="empty-children">Sin subcategorías {archived ? 'archivadas' : 'activas'}</p>}
              {!parent.archived && !archived && <button className="btn ghost" onClick={() => setEditor({ parent })}>
                <Icon name="plus" />Crear subcategoría
              </button>}
            </div>}
          </li>
        ))}</ul>}
      {editor && <CatalogEditor {...editor} api={api} catalog={query.data} side onClose={() => setEditor(null)}
        onSaved={(entry) => {
          setNotice('Se guardaron los cambios en ' + entry.name + '.');
          setEditor(null);
        }} />}
    </section>
  );
}
