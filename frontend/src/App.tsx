import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SendPage } from './pages/SendPage';
import { Skeleton } from './components/ui';

const ClaimPage = lazy(() => import('./pages/ClaimPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const LabPage = lazy(() => import('./pages/LabPage'));
const JudgesPage = lazy(() => import('./pages/JudgesPage'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="mx-auto max-w-md p-8"><Skeleton className="h-8 w-48" /></div>}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<SendPage />} />
            <Route path="/c/:id" element={<ClaimPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/dashboard" element={<Navigate to="/stats" replace />} />
            <Route path="/lab" element={<LabPage />} />
            <Route path="/judges" element={<JudgesPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
