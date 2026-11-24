import { useQuery } from '@tanstack/react-query';

// Claves: [uuid, recurso, argumentos]. Los argumentos incluyen la moneda, por lo
// que una respuesta tardía de otra moneda nunca se muestra con la clave actual, y
// sin placeholderData los importes anteriores se ocultan al cambiar de filtros
// (ARCH-01 §11–12). El período general solo forma parte de la clave de get_stats.
const options = { staleTime: 30_000, retry: false, networkMode: 'always' };

export function useStats(api, args, enabled = true) {
  return useQuery({
    queryKey: [api.owner, 'stats', args],
    queryFn: ({ signal }) => api.rpc('get_stats', args, signal),
    enabled, ...options,
  });
}

export function useAnnual(api, args, enabled = true) {
  return useQuery({
    queryKey: [api.owner, 'annual', args],
    queryFn: ({ signal }) => api.rpc('get_annual', args, signal),
    enabled, ...options,
  });
}
