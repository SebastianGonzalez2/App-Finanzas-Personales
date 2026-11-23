import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '../components/AppShell.jsx';
import { AccessState } from '../features/auth/AccessState.jsx';
import { CallbackPage } from '../features/auth/CallbackPage.jsx';
import { LoginPage } from '../features/auth/LoginPage.jsx';
import { AccountMenu } from '../features/settings/AccountMenu.jsx';
import { account, categories, sections } from './navigation.js';
import { useAccess } from './sessionContext.js';

function PrivatePage({ title, isAccount = false }) {
  const access = useAccess();
  if (access.status === 'signedOut') return <Navigate to="/login" replace />;
  if (access.status !== 'allowed') return <AccessState {...access} />;

  return (
    <AppShell title={title} today={access.preferences.today}>
      {isAccount
        ? <AccountMenu session={access.session} />
        : <p className="page-note">Esta sección estará disponible más adelante.</p>}
    </AppShell>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<CallbackPage />} />
      {[...sections, categories].map(({ path, title }) => (
        <Route key={path} path={path} element={<PrivatePage title={title} />} />
      ))}
      <Route path={account.path} element={<PrivatePage title={account.title} isAccount />} />
      <Route path="/gastos/nuevo" element={<PrivatePage title="Nuevo gasto" />} />
      <Route path="/gastos/:id/editar" element={<PrivatePage title="Editar gasto" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
