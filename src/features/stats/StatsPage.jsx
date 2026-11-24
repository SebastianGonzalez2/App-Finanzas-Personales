import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useToast } from '../../app/toastContext.js';
import { useCatalog, useFinance } from '../../lib/finance.js';
import { usePreferenceActions } from '../settings/preferences.js';
import { AnnualPanelBody, AnnualTools } from './AnnualPanel.jsx';
import { CategoriesContent, ComparisonContent, FavoriteButton, MetricsContent, MonthlyContent, PanelBody, StatsPanel,
  SummaryContent } from './panels.jsx';
import { annualArgs, PANELS, readStatsQuery, statsArgs, writeStatsQuery, yearOf } from './query.js';
import { useAnnual, useStats } from './stats.js';
import { StatsFilters } from './StatsFilters.jsx';

function ViewTabs({ view, count, onChange }) {
  return (
    <div className="segments view-tabs" role="group" aria-label="Paneles">
      <button type="button" aria-pressed={view === 'todas'} onClick={() => onChange('todas')}>Todas</button>
      <button type="button" aria-pressed={view === 'favoritos'} onClick={() => onChange('favoritos')}>
        Mis favoritos{count > 0 && <span className="view-count"> · {count}</span>}
      </button>
    </div>
  );
}

export function StatsPage({ preferences }) {
  const api = useFinance();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const { today, currency, favorites } = preferences;
  const query = useMemo(() => readStatsQuery(new URLSearchParams(search), today), [search, today]);
  const back = '/estadisticas' + (location.search || '');
  const update = useCallback((patch) => {
    setParams((current) => writeStatsQuery({ ...readStatsQuery(current, today), ...patch }), { replace: true });
  }, [setParams, today]);
  const catalog = useCatalog(api);
  // Download the chart chunk alongside the first get_stats call instead of after it.
  useEffect(() => { void import('./charts.jsx'); }, []);
  const { favorite } = usePreferenceActions();
  const toast = useToast();
  const [pendingFavorites, setPendingFavorites] = useState(() => new Set());

  const visible = query.view === 'favoritos' ? PANELS.filter((panel) => favorites.includes(panel.id)) : PANELS;
  const args = useMemo(() => statsArgs(query, currency), [query, currency]);
  const yearArgs = useMemo(() => annualArgs(query, currency), [query, currency]);
  const stats = useStats(api, args, visible.some((panel) => panel.id !== 'annual'));
  const annual = useAnnual(api, yearArgs, visible.some((panel) => panel.id === 'annual'));
  // «Limpiar filtros» vuelve al mes actual sin clasificación, conservando la vista y la ventana anual.
  const clear = useCallback(() => setParams((current) => {
    const previous = readStatsQuery(current, today);
    return writeStatsQuery({ ...readStatsQuery(new URLSearchParams(), today), view: previous.view, annualEnd: previous.annualEnd });
  }, { replace: true }), [setParams, today]);

  function toggleFavorite(panel) {
    const enabled = !favorites.includes(panel.id);
    setPendingFavorites((current) => new Set(current).add(panel.id));
    favorite.mutate({ panel: panel.id, enabled }, {
      onError: () => toast.error(`No pudimos actualizar «${panel.title}» en Mis favoritos.`),
      onSettled: () => setPendingFavorites((current) => {
        const next = new Set(current);
        next.delete(panel.id);
        return next;
      }),
    });
  }

  const periodKey = JSON.stringify(args);
  function content(panel) {
    if (panel.id === 'annual') return <AnnualPanelBody annual={annual} back={back} onClear={clear} />;
    const body = {
      metrics: () => <MetricsContent data={stats.data} today={today} back={back} />,
      monthly: () => <MonthlyContent key={periodKey} api={api} data={stats.data} args={args} today={today} back={back} />,
      categories: () => <CategoriesContent api={api} data={stats.data} query={query} catalog={catalog.data} back={back}
        onBreakdown={(breakdown) => update({ breakdown })} />,
      comparison: () => <ComparisonContent data={stats.data} today={today} back={back} />,
      summary: () => <SummaryContent data={stats.data} today={today} />,
    }[panel.id];
    return <PanelBody query={stats} height={panel.id === 'metrics' ? 120 : 220} onClear={clear}>{stats.data && body()}</PanelBody>;
  }

  return (
    <div className="stats-page">
      <StatsFilters query={query} today={today} catalog={catalog.data} onChange={update} />
      <div className="select-line">
        <ViewTabs view={query.view} count={favorites.length} onChange={(view) => update({ view })} />
      </div>
      {visible.length === 0 ? (
        <div className="panel pad stats-empty" role="status">
          <h2>Todavía no elegiste paneles</h2>
          <p>Marcá la estrella de un panel en «Todas» para verlo acá. Tus favoritos se guardan en tu cuenta.</p>
          <button type="button" className="btn" onClick={() => update({ view: 'todas' })}>Ver todas</button>
        </div>
      ) : (
        <div className="stats-grid">
          {visible.map((panel) => (
            <StatsPanel key={panel.id} panel={panel} busy={(panel.id === 'annual' ? annual : stats).isFetching}
              tools={panel.id === 'annual' && <AnnualTools query={query} data={annual.data} onWindow={(end) => update({ annualEnd: end >= yearOf(today) ? null : end })} />}
              favorite={<FavoriteButton title={panel.title} pressed={favorites.includes(panel.id)}
                pending={pendingFavorites.has(panel.id)} onToggle={() => toggleFavorite(panel)} />}>
              {content(panel)}
            </StatsPanel>
          ))}
        </div>
      )}
    </div>
  );
}
