import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { supabase } from '../lib/supabase.js';
import { queryClient } from './queryClient.js';
import { AppRoutes } from './routes.jsx';
import { SessionProvider } from './SessionProvider.jsx';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider client={supabase}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  );
}
