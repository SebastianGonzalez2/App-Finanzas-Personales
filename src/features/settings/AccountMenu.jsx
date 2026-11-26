import { useEffect, useId, useRef, useState } from 'react';
import { useSession } from '../../app/sessionContext.js';
import { Icon } from '../../components/Icon.jsx';

const CLOSE_MS = 200;

export function AccountMenu() {
  const { snapshot, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  const email = snapshot.session?.user?.email ?? '';

  useEffect(() => {
    if (open) {
      let frame = 0;
      const start = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setExpanded(true));
      });
      return () => {
        window.cancelAnimationFrame(start);
        window.cancelAnimationFrame(frame);
      };
    }

    if (!rendered) return undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setRendered(false), reducedMotion ? 0 : CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setExpanded(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setExpanded(false);
      triggerRef.current?.focus();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      setExpanded(false);
    } else {
      setRendered(true);
      setOpen(true);
    }
  }

  return (
    <div ref={rootRef} className={`account-menu${expanded ? ' is-open' : ''}`}>
      <div className="account-menu__card">
        <div id={panelId} className="account-menu__collapse" aria-hidden={!open} inert={!open}>
          <div className="account-menu__collapse-inner">
            {rendered && (
              <section className="account-menu__panel" aria-label="Sesión de Google">
                <div className="tile account-menu__avatar" aria-hidden="true">
                  <Icon name="cuenta" />
                </div>
                <div className="account-menu__identity">
                  <p className="account-menu__label">Cuenta de Google</p>
                  <p className="account-menu__email">{email}</p>
                </div>
                <button
                  type="button"
                  className="btn account-menu__signout"
                  onClick={signOut}
                  tabIndex={open ? 0 : -1}
                >
                  Cerrar sesión
                </button>
              </section>
            )}
          </div>
        </div>
        <button
          ref={triggerRef}
          type="button"
          className="navitem account-menu__trigger"
          aria-label="Mi cuenta"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          <Icon name="cuenta" />
          <span>Mi cuenta</span>
        </button>
      </div>
    </div>
  );
}
