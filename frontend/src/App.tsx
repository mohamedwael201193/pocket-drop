import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import LandingPage from './pages/LandingPage';
import { Skeleton } from './components/ui';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ClaimEntryPage = lazy(() => import('./pages/ClaimEntryPage'));
const ClaimPage = lazy(() => import('./pages/ClaimPage'));
const RadarPage = lazy(() => import('./pages/RadarPage'));
const LabPage = lazy(() => import('./pages/LabPage'));
const JudgesPage = lazy(() => import('./pages/JudgesPage'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="mx-auto max-w-md p-8"><Skeleton className="h-8 w-48" /></div>}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/claim" element={<ClaimEntryPage />} />
            <Route path="/c/:id" element={<ClaimPage />} />
            <Route path="/radar" element={<RadarPage />} />
            <Route path="/stats" element={<Navigate to="/radar" replace />} />
            <Route path="/lab" element={<LabPage />} />
            <Route path="/judges" element={<JudgesPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
