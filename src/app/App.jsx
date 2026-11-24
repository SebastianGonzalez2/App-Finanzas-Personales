import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { supabase } from '../lib/supabase.js';
import { queryClient } from './queryClient.js';
import { AppRoutes } from './routes.jsx';
import { SessionProvider } from './SessionProvider.jsx';
import { ToastProvider } from './ToastProvider.jsx';

const router = createBrowserRouter([{ path: '*', element: <AppRoutes /> }]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider client={supabase}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
