import { useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { useAccess, useSession } from '../../app/sessionContext.js';
import { Icon } from '../../components/Icon.jsx';
import { AccessLayout } from './AccessLayout.jsx';
import { AccessState } from './AccessState.jsx';
import { signInWithGoogle } from './session.js';

function GoogleMark() {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.7 0-1.4-.2-2.1H12v4h5.4a4.7 4.7 0 0 1-2 3v2.6h3.2c1.9-1.8 3-4.4 3-7.5z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.6a6 6 0 0 1-9-3.1H3v2.7A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.4H3a10 10 0 0 0 0 9.2z" />
      <path fill="#EA4335" d="M12 6.1c1.5 0 2.7.5 3.7 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-9 5.4l3.4 2.7a5.9 5.9 0 0 1 5.6-4z" />
    </svg>
  );
}

export function LoginPage() {
  const { client } = useSession();
  const access = useAccess();
  const [attempt, setAttempt] = useState('idle');
  const starting = useRef(false);

  async function startGoogleLogin() {
    if (starting.current) return;
    starting.current = true;
    setAttempt('redirecting');
    try {
      const { error } = await signInWithGoogle(client, window.location.origin);
      if (!error) return;
    } catch {
      // Show a generic, retryable message without rendering provider errors.
    }
    starting.current = false;
    setAttempt('failed');
  }

  if (access.status === 'allowed') return <Navigate to="/" replace />;
  if (access.status !== 'signedOut' && access.status !== 'unconfigured') return <AccessState {...access} />;

  return (
    <AccessLayout title="Ingresá a tu espacio">
      <p>Usá tu cuenta de Google autorizada para consultar y registrar tus gastos.</p>
      <button
        className="btn primary"
        onClick={startGoogleLogin}
        disabled={!client || attempt === 'redirecting'}
        aria-describedby={!client ? 'login-configuration' : undefined}
      >
        <GoogleMark />
        {attempt === 'redirecting' ? 'Abriendo Google…' : 'Continuar con Google'}
      </button>
      <a className="panel-link" href="https://accounts.google.com/signin/recovery" referrerPolicy="no-referrer">
        Recuperar acceso en Google <Icon name="up" />
      </a>
      {!client && <p id="login-configuration" role="alert">El acceso todavía no está configurado.</p>}
      {attempt === 'failed' && <p role="alert">No pudimos abrir Google. Intentá de nuevo.</p>}
    </AccessLayout>
  );
}
