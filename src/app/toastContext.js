import { createContext, useContext } from 'react';

export const DEFAULT_TOAST_DURATION = 4000;
export const TOAST_EXIT_MS = 200;
export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_VARIANTS = ['success', 'error', 'warning', 'info'];

export const ToastContext = createContext(null);

export function normalizeVariant(variant) {
  return TOAST_VARIANTS.includes(variant) ? variant : 'info';
}

export function toastAriaProps(variant) {
  const assertive = variant === 'error' || variant === 'warning';
  return {
    role: assertive ? 'alert' : 'status',
    'aria-live': assertive ? 'assertive' : 'polite',
    'aria-atomic': 'true',
  };
}

export function createToastEntry(id, input) {
  const options = typeof input === 'string' ? { message: input } : (input ?? {});
  const message = typeof options.message === 'string' ? options.message.trim() : '';
  if (!message) return null;
  const duration = typeof options.duration === 'number' && options.duration >= 0
    ? options.duration
    : DEFAULT_TOAST_DURATION;
  return {
    id,
    variant: normalizeVariant(options.variant),
    message,
    action: options.action ?? null,
    duration,
    exiting: false,
  };
}

export function appendToast(list, entry, max = MAX_VISIBLE_TOASTS) {
  const next = [...list, entry];
  const active = next.filter((item) => !item.exiting);
  if (active.length <= max) return next;
  const excess = active.length - max;
  const dropIds = new Set(active.slice(0, excess).map((item) => item.id));
  return next.filter((item) => !dropIds.has(item.id));
}

export function catalogToastMessage(kind, target, patch) {
  const label = kind === 'subcategory' ? 'Subcategoría' : 'Categoría';
  if (!target) return `${label} creada`;
  if (patch?.archived === true) return `${label} archivada`;
  if (patch?.archived === false) return `${label} restaurada`;
  return `${label} actualizada`;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast debe usarse dentro de ToastProvider.');
  return context.api;
}

export function useToastState() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToastState debe usarse dentro de ToastProvider.');
  return context;
}
