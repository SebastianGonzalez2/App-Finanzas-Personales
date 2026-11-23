import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { AppShell } from '../components/AppShell.jsx';
import { AccessState } from '../features/auth/AccessState.jsx';
import { CallbackPage } from '../features/auth/CallbackPage.jsx';
import { LoginPage } from '../features/auth/LoginPage.jsx';
import { AccountMenu } from '../features/settings/AccountMenu.jsx';
import { CatalogPage } from '../features/catalog/CatalogPage.jsx';
import { ExpensePage } from '../features/expenses/ExpensePage.jsx';
import { ExpenseDetail } from '../features/expenses/ExpenseDetail.jsx';
import { account, categories, sections } from './navigation.js';
import { useAccess } from './sessionContext.js';

function PrivatePage({ title, subtitle, page }) {
  const access = useAccess();
  const location = useLocation();
  if (access.status === 'signedOut') return <Navigate to="/login" replace />;
  if (access.status !== 'allowed') return <AccessState {...access} />;

  return (
    <AppShell key={access.session.user.id} title={title} subtitle={subtitle} today={access.preferences.today}>
      {location.state?.notice?.owner === access.session.user.id && <div className="feedback" role="status">
        {location.state.notice.text}{location.state.notice.id && <Link className="notice-link"
          to={'/gastos/' + location.state.notice.id + '/editar'} state={{ from: location.pathname }}>Ver gasto</Link>}
      </div>}
      {page === 'account' ? <AccountMenu session={access.session} /> : page === 'catalog' ? <CatalogPage />
        : page === 'expense' ? <ExpensePage preferences={access.preferences} />
        : page === 'history' ? <ExpenseDetail />
        : <p className="page-note">Esta sección estará disponible más adelante.</p>}
    </AppShell>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<CallbackPage />} />
      {sections.map(({ path, title }) => (
        <Route key={path} path={path} element={<PrivatePage title={title} page={path === '/historial' ? 'history' : undefined} />} />
      ))}
      <Route path={categories.path} element={<PrivatePage title={categories.title} page="catalog" />} />
      <Route path={account.path} element={<PrivatePage title={account.title} page="account" />} />
      <Route path="/gastos/nuevo" element={<PrivatePage title="Nuevo gasto" subtitle="Registrá el importe, la fecha y la categoría." page="expense" />} />
      <Route path="/gastos/:id/editar" element={<PrivatePage title="Editar gasto" page="expense" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
