import { useCallback, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { toastAriaProps, useToastState } from '../app/toastContext.js';
import './ToastViewport.css';

function VariantIcon({ variant }) {
  if (variant === 'success') {
    return (
      <svg className="toast-badge-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.3"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.5 8.4 6.6 11.4 12.6 5.2" />
      </svg>
    );
  }
  if (variant === 'error') {
    return (
      <svg className="toast-badge-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 5l6 6M11 5l-6 6" />
      </svg>
    );
  }
  if (variant === 'warning') {
    return (
      <svg className="toast-badge-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 4.4v4.4M8 11.6h.01" />
      </svg>
    );
  }
  return (
    <svg className="toast-badge-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.1"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 7.4v4.2M8 4.6h.01" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="toast-close-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" aria-hidden="true">
      <path d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75" />
    </svg>
  );
}

function ToastItem({ toast, onDismiss }) {
  const location = useLocation();
  const remainingRef = useRef(toast.duration);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const pausedRef = useRef({
    hover: false,
    focus: false,
    pointer: false,
    hidden: typeof document !== 'undefined' ? document.hidden : false,
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const isPaused = useCallback(() => {
    const state = pausedRef.current;
    return state.hover || state.focus || state.pointer || state.hidden;
  }, []);

  const startTimer = useCallback(() => {
    if (toast.exiting || toast.duration <= 0 || isPaused() || timerRef.current !== null) return;
    if (remainingRef.current <= 0) {
      onDismiss(toast.id);
      return;
    }
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      remainingRef.current = 0;
      onDismiss(toast.id);
    }, remainingRef.current);
  }, [isPaused, onDismiss, toast.duration, toast.exiting, toast.id]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimer();
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
  }, [clearTimer]);

  const setPauseReason = useCallback((reason, active) => {
    if (pausedRef.current[reason] === active) return;
    pausedRef.current[reason] = active;
    if (isPaused()) pauseTimer();
    else startTimer();
  }, [isPaused, pauseTimer, startTimer]);

  useEffect(() => {
    if (toast.exiting) {
      clearTimer();
      return undefined;
    }
    startTimer();
    function handleVisibility() {
      setPauseReason('hidden', document.hidden);
    }
    function handlePointerRelease() {
      setPauseReason('pointer', false);
    }
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);
    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
    };
  }, [clearTimer, setPauseReason, startTimer, toast.exiting]);

  const aria = toastAriaProps(toast.variant);
  const from = location.pathname === '/historial' || location.pathname === '/estadisticas'
    ? location.pathname + location.search
    : location.pathname;
  const action = toast.action;

  return (
    <div
      className={`toast toast--${toast.variant}`}
      data-state={toast.exiting ? 'exiting' : 'open'}
      data-variant={toast.variant}
      {...aria}
      onMouseEnter={() => setPauseReason('hover', true)}
      onMouseLeave={() => setPauseReason('hover', false)}
      onFocus={() => setPauseReason('focus', true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setPauseReason('focus', false);
        }
      }}
      onPointerDown={() => setPauseReason('pointer', true)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onDismiss(toast.id);
        }
      }}
    >
      <span className="toast-badge" aria-hidden="true">
        <VariantIcon variant={toast.variant} />
      </span>
      <span className="toast-body">
        <span className="toast-message">{toast.message}</span>
        {action?.to && (
          <Link
            className="toast-action"
            to={action.to}
            state={action.state ?? { from }}
            onClick={() => onDismiss(toast.id)}
          >
            {action.label}
          </Link>
        )}
        {action && !action.to && action.onClick && (
          <button
            type="button"
            className="toast-action toast-action-button"
            onClick={() => {
              action.onClick();
              onDismiss(toast.id);
            }}
          >
            {action.label}
          </button>
        )}
      </span>
      <button
        type="button"
        className="toast-close"
        aria-label="Cerrar notificación"
        onClick={() => onDismiss(toast.id)}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export function ToastViewport() {
  const { toasts, dismiss } = useToastState();
  return (
    <div className="toast-viewport" aria-label="Notificaciones">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}
