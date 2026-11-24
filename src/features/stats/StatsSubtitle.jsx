import { useSearchParams } from 'react-router';
import { rangeTitle, readStatsQuery } from './query.js';

// Subtítulo de la cabecera: el período general elegido en la URL (UI-01).
export function StatsSubtitle({ today }) {
  const [params] = useSearchParams();
  return rangeTitle(readStatsQuery(params, today).range);
}
