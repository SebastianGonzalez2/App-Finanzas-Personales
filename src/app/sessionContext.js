import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accessStatus, untilNextCivilDay } from '../features/auth/session.js';

export const SessionContext = createContext(null);

export function useSession() {
  return useContext(SessionContext);
}

export function useAccess(enabled = true) {
  const { client, snapshot, logout, checkSession, recoverSession } = useSession();
  const owner = snapshot.session?.user.id;
  const query = useQuery({
    queryKey: ['session-preferences', snapshot.revision, owner],
    // A renewed token of the same person is verified again without unmounting the view: the
    // preferences already verified for that UUID stay on screen meanwhile. A rejection still
    // closes access. Another UUID never inherits them.
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === owner ? previous : undefined,
    queryFn: ({ signal }) => checkSession(snapshot, signal),
    enabled: enabled && Boolean(snapshot.session) && !logout,
    networkMode: 'always',
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    // The civil date (today) changes at midnight in Montevideo even if the tab stays open.
    refetchInterval: () => untilNextCivilDay(),
    refetchOnReconnect: 'always',
  });

  if (!client) return { status: 'unconfigured' };
  if (logout) return { status: logout };
  if (!enabled || !snapshot.ready) return { status: 'checking' };
  if (snapshot.recoveryError) return { status: 'failed', retry: recoverSession };
  if (!snapshot.session) return { status: 'signedOut' };
  if (query.isError) return { status: accessStatus(query.error.status), retry: query.refetch };
  if (!query.isSuccess) return { status: 'checking' };
  return { status: 'allowed', preferences: query.data, session: snapshot.session };
}
