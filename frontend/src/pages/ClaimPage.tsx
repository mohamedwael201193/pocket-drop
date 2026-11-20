import { Navigate, useParams } from 'react-router-dom';
import { parseLinkId } from '../lib/claim4';
import { lazyPage } from '../lib/lazyPage';

const ClaimV3Page = lazyPage(() => import('./ClaimV3Page'));
const ClaimV4Page = lazyPage(() => import('./ClaimV4Page'));

/** /c/:id. Plain numbers are v3 links (link #17 and older keep working); p12 / l12 are v4 drops on the prod / lab instance. */
export default function ClaimPage() {
  const { id = '' } = useParams();
  const p = parseLinkId(id);
  if (!p) return <Navigate to="/receive" replace state={{ badLink: `/c/${id}` }} />;
  return p.v === 3 ? <ClaimV3Page /> : <ClaimV4Page env={p.env} id={p.id} />;
}
