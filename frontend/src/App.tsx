import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { lazyPage } from './lib/lazyPage';

// Two separate bundles: the landing at "/" and the dashboard everywhere else. Neither imports the other.
const LandingPage = lazyPage(() => import('./landing/LandingPage'));
// The stored key is decrypted (or migrated) before the dashboard's first render, so every synchronous read sees it.
const AppShell = lazyPage(async () => {
  const { unlockVault } = await import('./lib/vault');
  await unlockVault().catch(() => undefined);
  return import('./AppShell');
});

const OverviewPage = lazyPage(() => import('./pages/OverviewPage'));
const SendPage = lazyPage(() => import('./pages/SendPage'));
const InboxPage = lazyPage(() => import('./pages/InboxPage'));
const ReceivePage = lazyPage(() => import('./pages/ReceivePage'));
const NotFoundPage = lazyPage(() => import('./pages/NotFoundPage'));
const ClaimPage = lazyPage(() => import('./pages/ClaimPage'));
const PoolClaimPage = lazyPage(() => import('./pages/PoolClaimPage'));
const PublicPoolPage = lazyPage(() => import('./pages/PublicPoolPage'));
const PocketPage = lazyPage(() => import('./pages/PocketPage'));
const ProofPage = lazyPage(() => import('./pages/ProofPage'));
const TestersPage = lazyPage(() => import('./pages/TestersPage'));
const RadarPage = lazyPage(() => import('./pages/RadarPage'));
const LabPage = lazyPage(() => import('./pages/LabPage'));
const JudgesPage = lazyPage(() => import('./pages/JudgesPage'));
const QdayPage = lazyPage(() => import('./pages/QdayPage'));
const CheckTxPage = lazyPage(() => import('./pages/CheckTxPage'));

/** /claim/<id>#k=… → /c/<id>#k=… (query and key fragment kept). */
function ClaimAlias() {
  const { id = '' } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`/c/${id}${search}${hash}`} replace />;
}

/** The whole route table. Exported so test/routes.test.ts can check every deep link without a browser. */
export function AppRoutes() {
  return (
    <Routes>
      {/* Landing */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/about" element={<Navigate to="/" replace />} />
      <Route path="/claim/:id" element={<ClaimAlias />} />
      <Route element={<AppShell />}>
        {/* Overview: the dashboard home */}
        <Route path="/app" element={<OverviewPage />} />
        <Route path="/overview" element={<Navigate to="/app" replace />} />
        {/* Send tab */}
        <Route path="/send" element={<SendPage />} />
        <Route path="/send/inbox" element={<InboxPage />} />
        <Route path="/dashboard" element={<Navigate to="/send" replace />} />
        {/* Receive tab */}
        <Route path="/receive" element={<ReceivePage />} />
        <Route path="/claim" element={<Navigate to="/receive" replace />} />
        <Route path="/claim/*" element={<Navigate to="/receive" replace />} />
        <Route path="/c/:id" element={<ClaimPage />} />
        <Route path="/pool" element={<PublicPoolPage />} />
        <Route path="/pool/:id" element={<PoolClaimPage />} />
        {/* Pocket tab */}
        <Route path="/pocket" element={<PocketPage />} />
        {/* Proof tab */}
        <Route path="/proof" element={<ProofPage />} />
        <Route path="/proof/testers" element={<TestersPage />} />
        <Route path="/lab" element={<LabPage />} />
        <Route path="/radar" element={<RadarPage />} />
        <Route path="/stats" element={<Navigate to="/radar" replace />} />
        <Route path="/judges" element={<JudgesPage />} />
        <Route path="/qday" element={<QdayPage />} />
        <Route path="/check" element={<CheckTxPage />} />
        <Route path="/check/:hash" element={<CheckTxPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

const Boot = () => <div className="min-h-screen" data-testid="boot" />;

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Boot />}>
        <AppRoutes />
      </Suspense>
    </BrowserRouter>
  );
}
