import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { account, categories, sections } from '../app/navigation.js';
import { Brand } from './Brand.jsx';
import { Icon } from './Icon.jsx';

function NavItem({ item, onNavigate }) {
  return (
    <NavLink to={item.path} end className="navitem" aria-label={item.title} onClick={onNavigate}>
      <Icon name={item.icon} />
      <span>{item.title}</span>
    </NavLink>
  );
}

function Navigation({ onNavigate }) {
  return (
    <nav className="rail-nav" aria-label="Navegación principal">
      <div className="rail-label">Mi espacio</div>
      {sections.map((item) => <NavItem key={item.path} item={item} onNavigate={onNavigate} />)}
      <div className="navdiv" />
      <div className="rail-label">Organización</div>
      <NavItem item={categories} onNavigate={onNavigate} />
      <div className="rail-foot"><NavItem item={account} onNavigate={onNavigate} /></div>
    </nav>
  );
}

function NavigationDialog({ onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  function close() {
    dialog.current.close();
    onClose();
  }

  return (
    <dialog id="navigation-menu" ref={dialog} className="sheet" aria-labelledby="navigation-title"
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="sheet-head">
        <h2 id="navigation-title">Navegación</h2>
        <button className="btn ghost" onClick={close} autoFocus>Cerrar</button>
      </div>
      <Navigation onNavigate={close} />
    </dialog>
  );
}

function NewExpenseLink() {
  return <Link to="/gastos/nuevo" className="btn primary"><Icon name="plus" />Nuevo gasto</Link>;
}

export function AppShell({ title, today, children }) {
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tablet, setTablet] = useState(() => window.matchMedia('(max-width: 860px)').matches);
  const menuTrigger = useRef(null);
  const { pathname } = useLocation();
  const expense = pathname.startsWith('/gastos/');
  const date = new Intl.DateTimeFormat('es-UY', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${today}T00:00:00Z`));

  useEffect(() => {
    const medium = window.matchMedia('(max-width: 860px)');
    function handleWidth(event) {
      setTablet(event.matches);
      if (!event.matches) setMenuOpen(false);
    }
    medium.addEventListener('change', handleWidth);
    return () => medium.removeEventListener('change', handleWidth);
  }, []);

  function toggleNavigation(event) {
    if (tablet) {
      menuTrigger.current = event.currentTarget;
      setMenuOpen(true);
    } else {
      setCompact((previous) => !previous);
    }
  }

  function closeMenu() {
    setMenuOpen(false);
    menuTrigger.current?.focus();
  }

  return (
    <div className={`shell${compact || tablet ? ' compact' : ''}`}>
      <a href="#contenido" className="skip-link">Ir al contenido</a>
      <aside className="rail">
        <div className="rail-inner">
          <div className="rail-head">
            <Brand />
            <button className="square" onClick={toggleNavigation}
              aria-label={compact || tablet ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
              aria-expanded={tablet ? menuOpen : !compact}
              aria-controls={tablet ? (menuOpen ? 'navigation-menu' : undefined) : 'sidebar-navigation'}>
              <Icon name="panel" />
            </button>
          </div>
          <div className="sidebar-navigation" id="sidebar-navigation"><Navigation /></div>
        </div>
      </aside>
      <div>
        <header className="topbar">
          <div className="crumb"><Icon name="fold" />Espacio personal <span aria-hidden="true">/</span> {title}</div>
          <time className="context" dateTime={today}><Icon name="date" />{date}</time>
        </header>
        <header className="mobile-head">
          <div className="mobile-brand">
            <button className="square" onClick={toggleNavigation} aria-label="Ver menú"
              aria-expanded={menuOpen} aria-controls={menuOpen ? 'navigation-menu' : undefined}>
              <Icon name="menu" />
            </button>
            <Brand />
          </div>
          {!expense && <NewExpenseLink />}
        </header>
        <main className="page" id="contenido" tabIndex={-1}>
          <header className="page-head">
            <h1>{title}</h1>
            {!expense && <div className="desktop-action"><NewExpenseLink /></div>}
          </header>
          {children}
        </main>
      </div>
      {menuOpen && <NavigationDialog onClose={closeMenu} />}
    </div>
  );
}
