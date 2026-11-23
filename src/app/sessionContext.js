import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accessStatus } from '../features/auth/session.js';

export const SessionContext = createContext(null);

export function useSession() {
  return useContext(SessionContext);
}

export function useAccess(enabled = true) {
  const { client, snapshot, logout, checkSession } = useSession();
  const query = useQuery({
    queryKey: ['session-preferences', snapshot.revision],
    queryFn: ({ signal }) => checkSession(snapshot, signal),
    enabled: enabled && Boolean(snapshot.session) && !logout,
    networkMode: 'always',
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  if (!client) return { status: 'unconfigured' };
  if (logout) return { status: logout };
  if (!enabled || !snapshot.ready) return { status: 'checking' };
  if (!snapshot.session) return { status: 'signedOut' };
  if (query.isError) return { status: accessStatus(query.error.status), retry: query.refetch };
  if (!query.isSuccess) return { status: 'checking' };
  return { status: 'allowed', preferences: query.data, session: snapshot.session };
}
