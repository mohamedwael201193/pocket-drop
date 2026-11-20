import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import LandingPage from './pages/LandingPage';
import { Skeleton } from './components/ui';
import { AccountProvider } from './lib/account';

const SendPage = lazy(() => import('./pages/SendPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const ReceivePage = lazy(() => import('./pages/ReceivePage'));
const ClaimPage = lazy(() => import('./pages/ClaimPage'));
const PoolClaimPage = lazy(() => import('./pages/PoolClaimPage'));
const PocketPage = lazy(() => import('./pages/PocketPage'));
const ProofPage = lazy(() => import('./pages/ProofPage'));
const RadarPage = lazy(() => import('./pages/RadarPage'));
const LabPage = lazy(() => import('./pages/LabPage'));
const JudgesPage = lazy(() => import('./pages/JudgesPage'));

export default function App() {
  return (
    <BrowserRouter>
      <AccountProvider>
        <Suspense fallback={<div className="mx-auto max-w-md p-8"><Skeleton className="h-8 w-48" /></div>}>
          <Routes>
            <Route element={<Layout />}>
              {/* Send tab */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/send" element={<SendPage />} />
              <Route path="/send/inbox" element={<InboxPage />} />
              <Route path="/dashboard" element={<Navigate to="/send" replace />} />
              {/* Receive tab */}
              <Route path="/receive" element={<ReceivePage />} />
              <Route path="/claim" element={<Navigate to="/receive" replace />} />
              <Route path="/c/:id" element={<ClaimPage />} />
              <Route path="/pool/:id" element={<PoolClaimPage />} />
              {/* Pocket tab */}
              <Route path="/pocket" element={<PocketPage />} />
              {/* Proof tab */}
              <Route path="/proof" element={<ProofPage />} />
              <Route path="/lab" element={<LabPage />} />
              <Route path="/radar" element={<RadarPage />} />
              <Route path="/stats" element={<Navigate to="/radar" replace />} />
              <Route path="/judges" element={<JudgesPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </AccountProvider>
    </BrowserRouter>
  );
}
