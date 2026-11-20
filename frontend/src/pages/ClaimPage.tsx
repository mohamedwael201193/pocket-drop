import { lazy } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { parseLinkId } from '../lib/claim4';

const ClaimV3Page = lazy(() => import('./ClaimV3Page'));
const ClaimV4Page = lazy(() => import('./ClaimV4Page'));

/** /c/:id. Plain numbers are v3 links (link #17 and older keep working); p12 / l12 are v4 drops on the prod / lab instance. */
export default function ClaimPage() {
  const { id = '' } = useParams();
  const p = parseLinkId(id);
  if (!p) return <Navigate to="/receive" replace />;
  return p.v === 3 ? <ClaimV3Page /> : <ClaimV4Page env={p.env} id={p.id} />;
}
