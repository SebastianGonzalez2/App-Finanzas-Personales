/*
 * SpringSelect: port a JavaScript y CSS propio del componente original de EasyUI
 * (https://easyui.site/components/spring-select, MIT, © 2026 Suraj Maurya).
 *
 * El menú se despliega con resorte (stiffness 500, damping 30, mass 0.8), el chevron gira
 * levemente más allá de 180° antes de asentarse y el cierre retorna con una salida suave.
 * Se monta en portal (dentro del <dialog> activo si existe, o en document.body) para evitar
 * recortes por overflow en tarjetas o modales.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './SpringSelect.css';

const CLOSE_MS = 120;
const MENU_MAX_H = 260;
const GAP = 6;
const VIEWPORT_PAD = 8;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function findNextEnabled(options, start, step) {
  if (!options.length) return -1;
  let idx = start;
  for (let count = 0; count < options.length; count += 1) {
    idx += step;
    if (idx < 0) idx = 0;
    if (idx >= options.length) idx = options.length - 1;
    if (!options[idx]?.disabled) return idx;
    if (idx === 0 || idx === options.length - 1) break;
  }
  return start;
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="spring-select__check" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function SpringSelect({
  ref,
  options,
  value,
  defaultValue,
  placeholder = 'Seleccionar…',
  displayValue,
  icon,
  variant = 'field',
  align = 'start',
  menuMinWidth = 0,
  onChange,
  label,
  disabled = false,
  error,
  className,
  id,
  name,
  required,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}) {
  const generatedId = useId();
  const triggerId = id ?? `spring-select-${generatedId}-trigger`;
  const listboxId = `spring-select-${generatedId}-listbox`;

  const [phase, setPhase] = useState('closed'); // 'closed' | 'open' | 'closing'
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [side, setSide] = useState('bottom');
  const [portalHost, setPortalHost] = useState(null);

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const closeTimerRef = useRef(null);
  const typeaheadRef = useRef({ query: '', timer: null });

  const isControlled = value !== undefined;
  const current = isControlled ? value : internalValue;
  const currentOption = options.find((opt) => opt.value === current);
  const isOpen = phase === 'open';
  const isMounted = phase !== 'closed';

  const setTriggerNode = useCallback((node) => {
    triggerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    clearCloseTimer();
    if (prefersReducedMotion()) {
      setPhase('closed');
    } else {
      setPhase((prev) => (prev === 'open' ? 'closing' : prev));
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setPhase('closed');
      }, CLOSE_MS);
    }
    if (restoreFocus) triggerRef.current?.focus();
  }, [clearCloseTimer]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    clearCloseTimer();
    const selectedIdx = options.findIndex((opt) => opt.value === current && !opt.disabled);
    const firstEnabled = options.findIndex((opt) => !opt.disabled);
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : firstEnabled);
    setPortalHost(rootRef.current?.closest('dialog') ?? document.body);
    setPhase('open');
  }, [clearCloseTimer, current, disabled, options]);

  useEffect(() => () => {
    clearCloseTimer();
    if (typeaheadRef.current.timer) window.clearTimeout(typeaheadRef.current.timer);
  }, [clearCloseTimer]);

  // Cierra si el control pasa a deshabilitado mientras estaba abierto.
  useEffect(() => {
    if (disabled && isOpen) closeMenu(false);
  }, [disabled, isOpen, closeMenu]);

  // Posiciona el portal en coordenadas fijas y voltea hacia arriba si falta espacio abajo.
  useLayoutEffect(() => {
    if (!isMounted) return undefined;
    function place() {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const availableW = window.innerWidth - VIEWPORT_PAD * 2;
      const desiredW = Math.min(availableW, Math.max(rect.width, menuMinWidth));
      menu.style.minWidth = `${desiredW}px`;
      menu.style.maxWidth = `${availableW}px`;

      const menuRect = menu.getBoundingClientRect();
      const menuW = Math.min(availableW, Math.max(desiredW, menuRect.width));
      const estH = Math.min(MENU_MAX_H, menuRect.height || MENU_MAX_H);
      const below = window.innerHeight - rect.bottom - VIEWPORT_PAD;
      const above = rect.top - VIEWPORT_PAD;
      const nextSide = below < estH + GAP && above >= estH + GAP ? 'top' : 'bottom';
      setSide(nextSide);

      const top = nextSide === 'top'
        ? Math.max(VIEWPORT_PAD, rect.top - estH - GAP)
        : Math.min(window.innerHeight - VIEWPORT_PAD - estH, rect.bottom + GAP);
      const rawLeft = align === 'end' ? rect.right - menuW : rect.left;
      const left = Math.max(VIEWPORT_PAD, Math.min(rawLeft, window.innerWidth - menuW - VIEWPORT_PAD));

      menu.style.top = `${Math.round(top)}px`;
      menu.style.left = `${Math.round(left)}px`;
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [align, isMounted, menuMinWidth, options.length]);

  // Foco y cierre por clic externo / Escape cuando está abierto.
  useEffect(() => {
    if (!isOpen) return undefined;
    menuRef.current?.focus({ preventScroll: true });

    const onPointerDown = (event) => {
      const target = event.target;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isOpen, closeMenu]);

  // Mantiene la opción activa visible al navegar con flechas.
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const item = menuRef.current?.children?.[activeIndex];
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, isOpen]);

  const handleSelect = (opt, idx) => {
    if (!opt || opt.disabled) return;
    if (!isControlled) setInternalValue(opt.value);
    setActiveIndex(idx);
    closeMenu(true);
    onChange?.(opt.value);
  };

  const handleTriggerKeyDown = (event) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) closeMenu(true);
      else openMenu();
    }
  };

  const handleListKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((idx) => findNextEnabled(options, idx < 0 ? -1 : idx, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((idx) => findNextEnabled(options, idx < 0 ? options.length : idx, -1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(options.findIndex((opt) => !opt.disabled));
    } else if (event.key === 'End') {
      event.preventDefault();
      for (let i = options.length - 1; i >= 0; i -= 1) {
        if (!options[i].disabled) { setActiveIndex(i); break; }
      }
    } else if ((event.key === 'Enter' || event.key === ' ') && activeIndex >= 0) {
      event.preventDefault();
      handleSelect(options[activeIndex], activeIndex);
    } else if (event.key === 'Tab') {
      closeMenu(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const next = (typeaheadRef.current.query + event.key).toLowerCase();
      typeaheadRef.current.query = next;
      if (typeaheadRef.current.timer) window.clearTimeout(typeaheadRef.current.timer);
      typeaheadRef.current.timer = window.setTimeout(() => { typeaheadRef.current.query = ''; }, 500);
      const found = options.findIndex((opt) => !opt.disabled && opt.label.toLowerCase().startsWith(next));
      if (found >= 0) setActiveIndex(found);
    }
  };

  const shownText = displayValue ?? currentOption?.label ?? placeholder;
  const isPlaceholder = displayValue === undefined && (!currentOption || (currentOption.value === '' && required));
  const invalid = Boolean(error || ariaInvalid);

  const rootClasses = [
    'spring-select',
    variant !== 'field' && `spring-select--${variant}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={rootClasses} data-spring-select="">
      {label && (
        <label htmlFor={triggerId} className="spring-select__label">
          {label}
        </label>
      )}

      <button
        ref={setTriggerNode}
        id={triggerId}
        name={name}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isMounted ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || undefined}
        data-value={current ?? ''}
        onClick={() => {
          if (disabled) return;
          if (isOpen) closeMenu(false);
          else openMenu();
        }}
        onKeyDown={handleTriggerKeyDown}
        className={[
          'spring-select__trigger',
          isPlaceholder && 'spring-select__trigger--placeholder',
        ].filter(Boolean).join(' ')}
      >
        <span className="spring-select__content">
          {icon && <span className="spring-select__icon" aria-hidden="true">{icon}</span>}
          <span className="spring-select__value">{shownText}</span>
        </span>
        <span className="spring-select__chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>

      {isMounted && portalHost && createPortal(
        <ul
          ref={menuRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-hidden={phase === 'closing' || undefined}
          aria-label={ariaLabel || label || undefined}
          data-side={side}
          data-state={phase}
          onKeyDown={handleListKeyDown}
          className="spring-select__menu"
        >
          {options.map((opt, idx) => {
            const selected = opt.value === current;
            const active = activeIndex === idx;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={selected}
                aria-disabled={opt.disabled || undefined}
                data-value={opt.value}
                data-active={active || undefined}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => handleSelect(opt, idx)}
                className="spring-select__option"
              >
                <span className="spring-select__option-text">
                  <span className="spring-select__option-label">{opt.label}</span>
                  {opt.description && (
                    <span className="spring-select__option-desc">{opt.description}</span>
                  )}
                </span>
                {selected && <CheckIcon />}
              </li>
            );
          })}
        </ul>,
        portalHost,
      )}

      {error && (
        <p className="spring-select__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
