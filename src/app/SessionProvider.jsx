import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getPreferences } from '../features/settings/preferences.js';
import { SessionContext } from './sessionContext.js';

const pendingKey = 'cifra:remote-logout-pending';
const initialSnapshot = { ready: false, session: null, revision: 0 };

function sessionMemory() {
  return { drafts: new Map(), lastExpenseId: null };
}

function readPendingLogout() {
  try {
    return window.localStorage.getItem(pendingKey) === '1';
  } catch {
    return false;
  }
}

function persistPendingLogout(pending) {
  try {
    if (pending) window.localStorage.setItem(pendingKey, '1');
    else window.localStorage.removeItem(pendingKey);
  } catch {
    // SessionProvider still blocks this tab if browser storage is unavailable.
  }
}

export function SessionProvider({ client, children }) {
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [logout, setLogout] = useState(() => readPendingLogout() ? 'logoutPending' : null);
  const current = useRef(initialSnapshot);
  const logoutInFlight = useRef(false);
  const refreshAttempted = useRef(false);
  const memory = useRef(null);
  if (!memory.current) memory.current = sessionMemory();

  useEffect(() => {
    if (!client) return;

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      const previous = current.current;
      const tokenChanged = previous.session?.access_token !== session?.access_token;
      if (previous.session?.user.id !== session?.user.id) {
        refreshAttempted.current = false;
        memory.current = sessionMemory();
      }
      if (tokenChanged) queryClient.clear();

      const next = { ready: true, session, revision: previous.revision + Number(tokenChanged) };
      current.current = next;
      setSnapshot(next);
    });

    function syncPendingLogout(event) {
      if (event.key !== pendingKey) return;
      if (event.newValue === '1') {
        memory.current = sessionMemory();
        queryClient.clear();
        setLogout('logoutPending');
      } else if (!logoutInFlight.current) {
        setLogout(null);
      }
    }

    window.addEventListener('storage', syncPendingLogout);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('storage', syncPendingLogout);
    };
  }, [client, queryClient]);

  async function checkSession(checked, signal) {
    try {
      const preferences = await getPreferences(client, checked.session.access_token, signal);
      if (!signal.aborted && current.current.revision === checked.revision) refreshAttempted.current = false;
      return preferences;
    } catch (error) {
      // Only the current token can trigger one explicit refresh after a 401.
      // TOKEN_REFRESHED updates the revision and starts a fresh verification.
      if (
        error.status === 401 && !signal.aborted && !refreshAttempted.current &&
        !logoutInFlight.current && !readPendingLogout() && current.current.revision === checked.revision
      ) {
        refreshAttempted.current = true;
        await client.auth.refreshSession();
      }
      throw error;
    }
  }

  async function signOut() {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    persistPendingLogout(true);
    memory.current = sessionMemory();
    setLogout('signingOut');
    queryClient.clear();

    try {
      const { data: { session }, error } = await client.auth.getSession();
      if (error) throw error;

      if (session) {
        // The SDK's local signOut clears browser storage before contacting Auth.
        // Revoke with the user's JWT first so an offline attempt can be retried after reload.
        const { error: remoteError } = await client.auth.admin.signOut(session.access_token, 'local');
        if (remoteError && !['session_not_found', 'user_not_found'].includes(remoteError.code)) {
          throw remoteError;
        }
        if (current.current.session?.access_token === session.access_token) {
          await client.auth.signOut({ scope: 'local' });
        }
      }

      refreshAttempted.current = false;
      persistPendingLogout(false);
      setLogout(null);
    } catch {
      setLogout('logoutPending');
    } finally {
      logoutInFlight.current = false;
    }
  }

  return (
    <SessionContext.Provider value={{ client, snapshot, logout, checkSession, signOut, memory: memory.current }}>
      {children}
    </SessionContext.Provider>
  );
}
