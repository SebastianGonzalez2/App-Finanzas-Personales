/*
 * DatePicker & DateRangePicker: port a JavaScript y CSS propio del componente original de EasyUI
 * (https://easyui.site/components/date-picker, MIT, © 2026 Suraj Maurya).
 *
 * Popover con resorte (stiffness 520, damping 38, mass 0.7), salida suave de 100 ms,
 * pausa de 160 ms tras elegir fecha para que la pastilla de selección se asiente antes
 * de cerrar, y portal fijo para evitar recortes por overflow.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, createCivilDate } from './Calendar.jsx';
import './DatePicker.css';

const POPOVER_HEIGHT = 340;
const CLOSE_ANIM_MS = 100;
const SELECT_BEAT_MS = 160;
const GAP = 8;
const VIEWPORT_PAD = 8;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function parseIsoDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = createCivilDate(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function formatIsoDate(date) {
  if (!date) return '';
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function useControllableState(value, defaultValue, onChange) {
  const [internal, setInternal] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : internal;

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const set = useCallback(
    (next) => {
      if (!controlled) setInternal(next);
      onChangeRef.current?.(next);
    },
    [controlled],
  );

  return [current, set];
}

function formatDate(date, locale = 'es-UY') {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function CalendarDaysIcon() {
  return (
    <svg className="date-picker__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
      <path d="M16 18h.01" />
    </svg>
  );
}

/* ───────────── shell: trigger + animated popover ───────────── */

function PickerShell({
  ref,
  id,
  name,
  text,
  placeholder,
  align = 'start',
  side: preferredSide = 'auto',
  disabled,
  className,
  dataValue,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  children,
}) {
  const generatedId = useId();
  const dialogId = `date-picker-${generatedId}-dialog`;

  const [phase, setPhase] = useState('closed'); // 'closed' | 'open' | 'closing'
  const [side, setSide] = useState('bottom');
  const [portalHost, setPortalHost] = useState(null);

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const selectTimerRef = useRef(null);
  const closeAnimTimerRef = useRef(null);

  const isOpen = phase === 'open';
  const isMounted = phase !== 'closed';

  const setTriggerNode = useCallback((node) => {
    triggerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const clearTimers = useCallback(() => {
    if (selectTimerRef.current !== null) {
      window.clearTimeout(selectTimerRef.current);
      selectTimerRef.current = null;
    }
    if (closeAnimTimerRef.current !== null) {
      window.clearTimeout(closeAnimTimerRef.current);
      closeAnimTimerRef.current = null;
    }
  }, []);

  const beginClose = useCallback((restoreFocus = false) => {
    clearTimers();
    if (prefersReducedMotion()) {
      setPhase('closed');
    } else {
      setPhase((prev) => (prev === 'open' ? 'closing' : prev));
      closeAnimTimerRef.current = window.setTimeout(() => {
        closeAnimTimerRef.current = null;
        setPhase('closed');
      }, CLOSE_ANIM_MS);
    }
    if (restoreFocus) {
      const active = document.activeElement;
      if (!active || active === document.body || rootRef.current?.contains(active) || popoverRef.current?.contains(active)) {
        triggerRef.current?.focus();
      }
    }
  }, [clearTimers]);

  // Brief beat (160 ms) so the selection pill lands before the popover closes.
  const closeAfterSelect = useCallback(() => {
    clearTimers();
    const delay = prefersReducedMotion() ? 0 : SELECT_BEAT_MS;
    if (delay === 0) {
      beginClose(true);
      return;
    }
    selectTimerRef.current = window.setTimeout(() => {
      selectTimerRef.current = null;
      beginClose(true);
    }, delay);
  }, [beginClose, clearTimers]);

  const openPopover = useCallback(() => {
    if (disabled) return;
    clearTimers();
    setPortalHost(rootRef.current?.closest('dialog') ?? document.body);
    setPhase('open');
  }, [clearTimers, disabled]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (disabled && isOpen) beginClose(false);
  }, [disabled, isOpen, beginClose]);

  useLayoutEffect(() => {
    if (!isMounted) return undefined;
    function place() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const rect = trigger.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      const popH = popRect.height || POPOVER_HEIGHT;
      const popW = popRect.width || 292;

      let nextSide;
      if (preferredSide && preferredSide !== 'auto') {
        nextSide = preferredSide;
      } else {
        const isMobile = window.innerWidth < 640;
        if (isMobile) {
          nextSide = 'bottom';
        } else {
          const below = window.innerHeight - rect.bottom;
          nextSide = below < popH + GAP && rect.top >= popH + GAP ? 'top' : 'bottom';
        }
      }
      setSide(nextSide);

      const rawTop = nextSide === 'top' ? rect.top - popH - GAP : rect.bottom + GAP;
      const top = Math.max(VIEWPORT_PAD, Math.min(rawTop, window.innerHeight - popH - VIEWPORT_PAD));
      const rawLeft = align === 'end' ? rect.right - popW : rect.left;
      const left = Math.max(VIEWPORT_PAD, Math.min(rawLeft, window.innerWidth - popW - VIEWPORT_PAD));

      popover.style.top = `${Math.round(top)}px`;
      popover.style.left = `${Math.round(left)}px`;
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [align, isMounted, preferredSide]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onDown = (event) => {
      const target = event.target;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      beginClose(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        beginClose(true);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [isOpen, beginClose]);

  return (
    <div ref={rootRef} className={['date-picker', className].filter(Boolean).join(' ')} data-date-picker="">
      <button
        ref={setTriggerNode}
        id={id}
        name={name}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isMounted ? dialogId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        data-value={dataValue ?? ''}
        onClick={() => {
          if (disabled) return;
          if (isOpen && selectTimerRef.current === null) beginClose(false);
          else openPopover();
        }}
        className="date-picker__trigger"
      >
        <CalendarDaysIcon />
        <span className={['date-picker__text', !text && 'date-picker__text--placeholder'].filter(Boolean).join(' ')}>
          {text ?? placeholder}
        </span>
      </button>

      {isMounted && portalHost && createPortal(
        <div
          ref={popoverRef}
          id={dialogId}
          role="dialog"
          aria-hidden={phase === 'closing' || undefined}
          aria-label="Elegir fecha"
          data-side={side}
          data-align={align}
          data-state={phase}
          className="date-picker__popover"
        >
          {children({ close: closeAfterSelect, closeNow: () => beginClose(true) })}
        </div>,
        portalHost,
      )}
    </div>
  );
}

/* ───────────── single date ───────────── */

export function DatePicker({
  ref,
  value,
  defaultValue = null,
  onChange,
  placeholder = 'Elegí una fecha',
  locale = 'es-UY',
  align = 'start',
  side = 'auto',
  disabled,
  clearable = false,
  className,
  id,
  name,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...calendar
}) {
  const [date, setDate] = useControllableState(value, defaultValue, onChange);

  return (
    <PickerShell
      ref={ref}
      id={id}
      name={name}
      text={date ? formatDate(date, locale) : null}
      placeholder={placeholder}
      align={align}
      side={side}
      disabled={disabled}
      className={className}
      dataValue={date ? formatIsoDate(date) : ''}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
    >
      {({ close, closeNow }) => (
        <Calendar
          mode="single"
          locale={locale}
          value={date}
          clearable={clearable}
          onClear={() => {
            setDate(null);
            closeNow();
          }}
          onChange={(next) => {
            setDate(next);
            close();
          }}
          {...calendar}
        />
      )}
    </PickerShell>
  );
}

/* ───────────── date range ───────────── */

export function DateRangePicker({
  ref,
  value,
  defaultValue = { from: null, to: null },
  onChange,
  placeholder = 'Elegí un rango',
  locale = 'es-UY',
  align = 'start',
  side = 'auto',
  disabled,
  clearable = false,
  className,
  id,
  name,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...calendar
}) {
  const [range, setRange] = useControllableState(value, defaultValue, onChange);
  const text = range?.from
    ? `${formatDate(range.from, locale)} – ${range.to ? formatDate(range.to, locale) : '…'}`
    : null;

  return (
    <PickerShell
      ref={ref}
      id={id}
      name={name}
      text={text}
      placeholder={placeholder}
      align={align}
      side={side}
      disabled={disabled}
      className={className}
      dataValue={range?.from ? `${formatIsoDate(range.from)}/${range.to ? formatIsoDate(range.to) : ''}` : ''}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
    >
      {({ close, closeNow }) => (
        <Calendar
          mode="range"
          locale={locale}
          value={range}
          clearable={clearable}
          onClear={() => {
            setRange({ from: null, to: null });
            closeNow();
          }}
          onChange={(next) => {
            setRange(next);
            if (next.from && next.to) close();
          }}
          {...calendar}
        />
      )}
    </PickerShell>
  );
}

/* ───────────── civil ISO adapter (YYYY-MM-DD) for Cifra ───────────── */

export function IsoDatePicker({ value, onChange, min, max, today, ...props }) {
  const parsed = useMemo(() => parseIsoDate(value), [value]);
  const minDate = useMemo(() => parseIsoDate(min), [min]);
  const maxDate = useMemo(() => parseIsoDate(max), [max]);
  const todayDate = useMemo(() => (typeof today === 'string' ? parseIsoDate(today) : today), [today]);

  return (
    <DatePicker
      {...props}
      value={parsed}
      minDate={minDate}
      maxDate={maxDate}
      today={todayDate}
      onChange={(next) => onChange?.(next ? formatIsoDate(next) : '')}
    />
  );
}
