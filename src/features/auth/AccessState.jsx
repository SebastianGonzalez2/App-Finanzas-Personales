import { Link, useNavigate } from 'react-router';
import { useSession } from '../../app/sessionContext.js';
import { AccessLayout } from './AccessLayout.jsx';

export function AccessState({ status, retry }) {
  const { snapshot, signOut } = useSession();
  const navigate = useNavigate();

  async function signOutToLogin() {
    if (await signOut()) navigate('/login', { replace: true });
  }

  switch (status) {
    case 'checking':
      return <AccessLayout title="Verificando tu sesión…" role="status" />;
    case 'signingOut':
      return <AccessLayout title="Cerrando sesión…" role="status" />;
    case 'logoutPending':
      return (
        <AccessLayout title="Cierre remoto pendiente" role="alert" icon="info">
          <p>Revisá tu conexión para confirmar el cierre de sesión.</p>
          <button className="btn primary" onClick={signOutToLogin} disabled={!snapshot.ready}>Reintentar cierre</button>
        </AccessLayout>
      );
    case 'denied':
      return (
        <AccessLayout title="Esta cuenta no tiene acceso" role="alert" icon="info">
          <p>Si estás completando el alta, el acceso queda pendiente de habilitación.</p>
          {snapshot.session ? (
            <button className="btn primary" onClick={signOutToLogin}>Salir y elegir otra cuenta</button>
          ) : (
            <Link className="btn primary" to="/login" replace>Elegir otra cuenta</Link>
          )}
        </AccessLayout>
      );
    case 'expired':
    case 'sessionExpired':
    case 'exchangeFailed':
      return (
        <AccessLayout
          title={{
            expired: 'El enlace de acceso venció',
            sessionExpired: 'Tu sesión venció',
            exchangeFailed: 'No pudimos iniciar tu sesión',
          }[status]}
          role="alert" icon="info"
        >
          {snapshot.session ? (
            <button className="btn primary" onClick={signOutToLogin}>Volver a ingresar</button>
          ) : (
            <Link className="btn primary" to="/login" replace>Volver a ingresar</Link>
          )}
        </AccessLayout>
      );
    case 'failed':
      return (
        <AccessLayout title="No pudimos verificar tu sesión" role="alert" icon="info">
          <p>Revisá tu conexión e intentá de nuevo.</p>
          <button className="btn primary" onClick={() => retry()}>Reintentar</button>
        </AccessLayout>
      );
    case 'unconfigured':
      return (
        <AccessLayout title="El acceso todavía no está configurado" role="alert" icon="info">
          <p>Falta conectar esta instalación con su proyecto Supabase.</p>
        </AccessLayout>
      );
    default:
      return null;
  }
}
