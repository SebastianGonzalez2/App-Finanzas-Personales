import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isTransientAuthError, SessionCheckError } from '../features/auth/session.js';
import { getPreferences } from '../features/settings/preferences.js';
import { SessionContext } from './sessionContext.js';

const pendingKey = 'cifra:remote-logout-pending';
const initialSnapshot = { ready: false, session: null, revision: 0, recoveryError: false };

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

function clearRefreshCooldown(client) {
  if (client?.auth && 'lastRefreshFailure' in client.auth) {
    client.auth.lastRefreshFailure = null;
  }
}

export function SessionProvider({ client, children }) {
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [logout, setLogout] = useState(() => readPendingLogout() ? 'logoutPending' : null);
  const current = useRef(initialSnapshot);
  const logoutInFlight = useRef(false);
  const refreshAttempted = useRef(false);
  const recoveryInFlight = useRef(false);
  const authEventVersion = useRef(0);
  const memory = useRef(null);
  if (!memory.current) memory.current = sessionMemory();

  const applySession = useCallback((session, recoveryError = false) => {
    const previous = current.current;
    const tokenChanged = previous.session?.access_token !== session?.access_token;
    // Financial data is cached per UUID: a renewed token of the same person keeps it, while
    // signing out or switching accounts discards every cached query and draft.
    if (previous.session?.user.id !== session?.user.id) {
      refreshAttempted.current = false;
      memory.current = sessionMemory();
      queryClient.clear();
    }

    const next = {
      ready: true,
      session,
      revision: previous.revision + Number(tokenChanged),
      recoveryError,
    };
    current.current = next;
    setSnapshot(next);
  }, [queryClient]);

  const recoverSession = useCallback(async () => {
    if (!client || recoveryInFlight.current || logoutInFlight.current || readPendingLogout()) return;
    recoveryInFlight.current = true;
    const version = authEventVersion.current;

    try {
      clearRefreshCooldown(client);
      const { data, error } = await client.auth.getSession();
      if (authEventVersion.current !== version && !data?.session) return;
      if (data?.session) {
        applySession(data.session, false);
      } else if (isTransientAuthError(error)) {
        applySession(null, true);
      } else {
        applySession(null, false);
      }
    } catch (error) {
      if (authEventVersion.current === version) {
        applySession(null, isTransientAuthError(error));
      }
    } finally {
      recoveryInFlight.current = false;
    }
  }, [applySession, client]);

  useEffect(() => {
    if (!client) return;
    let active = true;

    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      const version = ++authEventVersion.current;

      // When cold-start refresh fails transiently (offline / 5xx), GoTrue keeps the session
      // in storage but still emits INITIAL_SESSION with null. Inspect getSession() before
      // treating the user as signed out so connectivity hiccups never bounce to /login.
      if (event === 'INITIAL_SESSION' && !session && !logoutInFlight.current && !readPendingLogout()) {
        void client.auth.getSession().then(({ data, error }) => {
          if (!active || authEventVersion.current !== version) return;
          if (data?.session) {
            applySession(data.session, false);
          } else if (isTransientAuthError(error)) {
            applySession(null, true);
          } else {
            applySession(null, false);
          }
        }).catch((error) => {
          if (!active || authEventVersion.current !== version) return;
          applySession(null, isTransientAuthError(error));
        });
        return;
      }

      applySession(session, false);
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

    function handleReconnect() {
      if (current.current.recoveryError) void recoverSession();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') handleReconnect();
    }

    window.addEventListener('storage', syncPendingLogout);
    window.addEventListener('online', handleReconnect);
    window.addEventListener('pageshow', handleReconnect);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener('storage', syncPendingLogout);
      window.removeEventListener('online', handleReconnect);
      window.removeEventListener('pageshow', handleReconnect);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [applySession, client, queryClient, recoverSession]);

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
        clearRefreshCooldown(client);
        let refreshError;
        try {
          ({ error: refreshError } = await client.auth.refreshSession());
        } catch (caught) {
          refreshError = caught;
        }
        if (isTransientAuthError(refreshError)) {
          refreshAttempted.current = false;
          throw new SessionCheckError(0);
        }
      }
      throw error;
    }
  }

  async function signOut() {
    if (logoutInFlight.current) return false;
    logoutInFlight.current = true;
    persistPendingLogout(true);
    memory.current = sessionMemory();
    setLogout('signingOut');
    queryClient.clear();

    try {
      clearRefreshCooldown(client);
      const { data: { session }, error } = await client.auth.getSession();
      if (error) {
        if (isTransientAuthError(error)) throw error;
        await client.auth.signOut({ scope: 'local' });
      } else if (session) {
        // The SDK's local signOut clears browser storage before contacting Auth.
        // Revoke with the user's JWT first so an offline attempt can be retried after reload.
        const { error: remoteError } = await client.auth.admin.signOut(session.access_token, 'local');
        if (remoteError && !['session_not_found', 'user_not_found'].includes(remoteError.code)) {
          throw remoteError;
        }
        if (!current.current.session || current.current.session.access_token === session.access_token) {
          await client.auth.signOut({ scope: 'local' });
        }
      }

      refreshAttempted.current = false;
      if (current.current.recoveryError) applySession(null, false);
      persistPendingLogout(false);
      setLogout(null);
      return true;
    } catch {
      setLogout('logoutPending');
      return false;
    } finally {
      logoutInFlight.current = false;
    }
  }

  return (
    <SessionContext.Provider value={{ client, snapshot, logout, checkSession, recoverSession, signOut, memory: memory.current }}>
      {children}
    </SessionContext.Provider>
  );
}
