import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../app/sessionContext.js';
import { useFinance } from '../../lib/finance.js';
import { SessionCheckError } from '../auth/session.js';

export const PANEL_ORDER = ['metrics', 'monthly', 'categories', 'comparison', 'annual', 'summary'];

export async function getPreferences(client, accessToken, signal) {
  const { data, error, status } = await client.schema('api').rpc('get_preferences')
    .setHeader('Authorization', `Bearer ${accessToken}`)
    .abortSignal(signal);

  if (error) throw new SessionCheckError(status);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data?.today) || !Number.isFinite(Date.parse(data.today))) {
    throw new SessionCheckError(500);
  }
  return data;
}

// Moneda compartida y favoritos (RF-021). La preferencia confirmada vive en la caché de
// get_preferences de la sesión: Resumen, Estadísticas y Presupuestos leen el mismo valor.
// Solo se actualiza tras la respuesta del servidor; ante un error se conserva la anterior.
export function usePreferenceActions() {
  const api = useFinance();
  const { snapshot } = useSession();
  const cache = useQueryClient();
  const queryKey = ['session-preferences', snapshot.revision];
  async function confirm(update) {
    // A get_preferences started before the write could otherwise restore the old value.
    await cache.cancelQueries({ queryKey, exact: true });
    cache.setQueryData(queryKey, (current) => current && update(current));
  }
  const currency = useMutation({
    mutationFn: (code) => api.rpc('set_currency', { currency: code }),
    onSuccess: (data) => confirm((current) => ({ ...current, currency: data.currency })),
  });
  const favorite = useMutation({
    mutationFn: ({ panel, enabled }) => api.rpc('set_favorite', { panel, enabled }),
    onSuccess: (data) => confirm((current) => {
      const chosen = new Set(current.favorites);
      if (data.enabled) chosen.add(data.panel);
      else chosen.delete(data.panel);
      return { ...current, favorites: PANEL_ORDER.filter((panel) => chosen.has(panel)) };
    }),
  });
  return { currency, favorite };
}
