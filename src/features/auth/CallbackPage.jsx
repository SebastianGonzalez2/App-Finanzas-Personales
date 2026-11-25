import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAccess, useSession } from '../../app/sessionContext.js';
import { AccessState } from './AccessState.jsx';
import { exchangeSession, readCallback } from './session.js';

export function CallbackPage() {
  const { client, logout } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [callback] = useState(() => readCallback(location.search));
  const [result, setResult] = useState(callback.status);
  const exchange = useRef(null);
  // Also verify any already-persisted session when /auth/callback is opened without a fresh code
  // (e.g., legacy mobile PWA shortcuts, OS task/intent relaunch, or a replayed callback URL).
  const access = useAccess(result === 'complete' || result === 'expired');

  useEffect(() => {
    if (location.search || location.hash) navigate('/auth/callback', { replace: true });
  }, [location.search, location.hash, navigate]);

  useEffect(() => {
    if (!client || logout || callback.status !== 'exchange') return;
    // Strict Mode can run this effect twice. Both effect runs share one exchange.
    exchange.current ??= exchangeSession(client, callback.code);
    let active = true;
    exchange.current.then((outcome) => {
      if (active) setResult(outcome);
    });
    return () => { active = false; };
  }, [client, logout, callback]);

  if (!client || logout) return <AccessState {...access} />;
  if (result === 'exchange') return <AccessState status="checking" />;
  if (result === 'expired') {
    if (access.status === 'allowed') return <Navigate to="/" replace />;
    if (access.status === 'signedOut') return <AccessState status="expired" />;
    return <AccessState {...access} />;
  }
  if (result !== 'complete') return <AccessState status={result} />;
  if (access.status === 'allowed') return <Navigate to="/" replace />;
  if (access.status === 'signedOut') return <Navigate to="/login" replace />;
  return <AccessState {...access} />;
}
