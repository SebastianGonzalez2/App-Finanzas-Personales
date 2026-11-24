import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from './sessionContext.js';
import { appendToast, createToastEntry, ToastContext, TOAST_EXIT_MS } from './toastContext.js';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ToastProvider({ children }) {
  const sessionContext = useSession();
  const userId = sessionContext?.snapshot?.session?.user?.id ?? null;
  const [toasts, setToasts] = useState([]);
  const [trackedUser, setTrackedUser] = useState(userId);
  const nextId = useRef(0);
  const exitTimers = useRef(new Map());

  // No conservar notificaciones privadas al cerrar sesión o cambiar de cuenta.
  if (trackedUser !== userId) {
    setTrackedUser(userId);
    if (toasts.length) setToasts([]);
  }

  const cancelExitTimer = useCallback((id) => {
    const timer = exitTimers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      exitTimers.current.delete(id);
    }
  }, []);

  const remove = useCallback((id) => {
    cancelExitTimer(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, [cancelExitTimer]);

  const dismiss = useCallback((id) => {
    if (prefersReducedMotion()) {
      remove(id);
      return;
    }
    setToasts((current) => {
      const target = current.find((item) => item.id === id);
      if (!target || target.exiting) return current;
      return current.map((item) => (item.id === id ? { ...item, exiting: true } : item));
    });
    if (!exitTimers.current.has(id)) {
      const timer = window.setTimeout(() => remove(id), TOAST_EXIT_MS);
      exitTimers.current.set(id, timer);
    }
  }, [remove]);

  const clear = useCallback(() => {
    for (const timer of exitTimers.current.values()) window.clearTimeout(timer);
    exitTimers.current.clear();
    setToasts([]);
  }, []);

  const show = useCallback((input) => {
    const id = ++nextId.current;
    const entry = createToastEntry(id, input);
    if (!entry) return null;
    setToasts((current) => appendToast(current, entry));
    return id;
  }, []);

  useEffect(() => {
    const timers = exitTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [userId]);

  const api = useMemo(() => ({
    show,
    success: (message, options) => show({ ...options, message, variant: 'success' }),
    error: (message, options) => show({ ...options, message, variant: 'error' }),
    warning: (message, options) => show({ ...options, message, variant: 'warning' }),
    info: (message, options) => show({ ...options, message, variant: 'info' }),
    dismiss,
    clear,
  }), [show, dismiss, clear]);

  const value = useMemo(() => ({ toasts, api, dismiss }), [toasts, api, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}
