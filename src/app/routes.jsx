import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, ScrollRestoration } from 'react-router';
import { AppBackground } from '../components/AppBackground.jsx';
import { AppShell } from '../components/AppShell.jsx';
import { ToastViewport } from '../components/ToastViewport.jsx';
import { AccessState } from '../features/auth/AccessState.jsx';
import { CallbackPage } from '../features/auth/CallbackPage.jsx';
import { LoginPage } from '../features/auth/LoginPage.jsx';
import { BudgetsPage } from '../features/budgets/BudgetsPage.jsx';
import { monthTitle } from '../features/budgets/budgets.js';
import { CatalogPage } from '../features/catalog/CatalogPage.jsx';
import { ExpensePage } from '../features/expenses/ExpensePage.jsx';
import { HistoryPage } from '../features/history/HistoryPage.jsx';
import { OverviewPage } from '../features/overview/OverviewPage.jsx';
import { RecurringPage } from '../features/recurring/RecurringPage.jsx';
import { StatsSubtitle } from '../features/stats/StatsSubtitle.jsx';
import { CurrencySelect } from '../components/CurrencySelect.jsx';
import { categories, sections } from './navigation.js';
import { useAccess } from './sessionContext.js';

// Estadísticas (y Recharts, en su propio chunk) solo se descargan al abrir la sección.
const StatsPage = lazy(() => import('../features/stats/StatsPage.jsx').then((module) => ({ default: module.StatsPage })));

// Pantallas con la moneda de consulta compartida (RF-021) en la cabecera.
const currencyPages = new Set(['overview', 'stats', 'budgets']);

function PrivatePage({ title, subtitle, page }) {
  const access = useAccess();
  if (access.status === 'signedOut') return <Navigate to="/login" replace />;
  if (access.status !== 'allowed') return <AccessState {...access} />;

  const { today, currency } = access.preferences;
  const heading = page === 'stats' ? <StatsSubtitle today={today} />
    : page === 'overview' ? monthTitle(today)
    : page === 'budgets' ? 'Límites mensuales por categoría · ' + monthTitle(today)
    : subtitle;
  return (
    <AppShell key={access.session.user.id} title={title} today={today} subtitle={heading}
      actions={currencyPages.has(page) && <CurrencySelect current={currency} />}>
      {page === 'catalog' ? <CatalogPage />
        : page === 'expense' ? <ExpensePage preferences={access.preferences} />
        : page === 'history' ? <HistoryPage today={access.preferences.today} />
        : page === 'overview' ? <OverviewPage preferences={access.preferences} />
        : page === 'budgets' ? <BudgetsPage preferences={access.preferences} />
        : page === 'recurring' ? <RecurringPage preferences={access.preferences} />
        : page === 'stats' ? <Suspense fallback={<p className="query-state" role="status">Cargando estadísticas…</p>}>
          <StatsPage preferences={access.preferences} /></Suspense>
        : <p className="page-note">Esta sección estará disponible más adelante.</p>}
    </AppShell>
  );
}

// The history restores its scroll per exact query (path + filters), also after
// returning from the edit form; other views keep the default per-entry behaviour.
function scrollKey(location) {
  return location.pathname === '/historial' ? location.pathname + location.search : location.key;
}

export function AppRoutes() {
  return (
    <>
    <AppBackground />
    <ScrollRestoration getKey={scrollKey} />
    <ToastViewport />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<CallbackPage />} />
      {sections.map(({ path, title }) => (
        <Route key={path} path={path} element={path === '/historial'
          ? <PrivatePage title={title} subtitle="Consulta y edición de gastos registrados." page="history" />
          : path === '/estadisticas' ? <PrivatePage title={title} page="stats" />
          : path === '/' ? <PrivatePage title={title} page="overview" />
          : path === '/presupuestos' ? <PrivatePage title={title} page="budgets" />
          : path === '/pagos-recurrentes' ? <PrivatePage title={title} subtitle="Gastos mensuales que se registran automáticamente." page="recurring" />
          : <PrivatePage title={title} />} />
      ))}
      <Route path={categories.path} element={<PrivatePage title={categories.title} page="catalog" />} />
      <Route path="/gastos/nuevo" element={<PrivatePage title="Nuevo gasto" subtitle="Registrá el importe, la fecha y la categoría." page="expense" />} />
      <Route path="/gastos/:id/editar" element={<PrivatePage title="Editar gasto" page="expense" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
