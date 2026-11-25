import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './fonts.css';
import './index.css';
import { isNetworkFailure } from './lib/netfail';

// A background RPC read that failed at the network level (Safari reports these as CORS failures) is retried by the next poll;
// do not let it surface as an uncaught page error (B-08). Every other rejection still reaches the console as before.
window.addEventListener('unhandledrejection', (e) => {
  if (isNetworkFailure(e.reason)) { e.preventDefault(); console.warn('network read failed, will retry:', String((e.reason as Error)?.message ?? e.reason).slice(0, 160)); }
});

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 4_000, retry: 1, refetchOnWindowFocus: true } } });

// The key vault is unlocked by the dashboard chunk before its first render (App.tsx), so the landing paints without it.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
  </React.StrictMode>,
);
