import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import LandingPage from './pages/LandingPage';
import { Skeleton } from './components/ui';
import { AccountProvider } from './lib/account';
import { lazyPage } from './lib/lazyPage';

const SendPage = lazyPage(() => import('./pages/SendPage'));
const InboxPage = lazyPage(() => import('./pages/InboxPage'));
const ReceivePage = lazyPage(() => import('./pages/ReceivePage'));
const NotFoundPage = lazyPage(() => import('./pages/NotFoundPage'));
const ClaimPage = lazyPage(() => import('./pages/ClaimPage'));
const PoolClaimPage = lazyPage(() => import('./pages/PoolClaimPage'));
const PocketPage = lazyPage(() => import('./pages/PocketPage'));
const ProofPage = lazyPage(() => import('./pages/ProofPage'));
const RadarPage = lazyPage(() => import('./pages/RadarPage'));
const LabPage = lazyPage(() => import('./pages/LabPage'));
const JudgesPage = lazyPage(() => import('./pages/JudgesPage'));
const QdayPage = lazyPage(() => import('./pages/QdayPage'));

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
              <Route path="/qday" element={<QdayPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </AccountProvider>
    </BrowserRouter>
  );
}
