import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { anonymousKey, createSender, exportSenderKey, forgetSender, importSender, linkAnonymousToOwner, loadLinks, loadSender, setOwner, type SenderAccount, type StoredLink } from './sender';
import { connectQorex, detectQorex, forgetQorex, qorexBalanceWei, restoreQorex, type QorexIdentity } from './qorex';
import { useBalance } from './queries';
import { hexToBytes } from './protocol';

type QorexState = 'checking' | 'missing' | 'ready' | 'connecting' | 'connected';
interface Ctx {
  identity: QorexIdentity | null;
  qorexState: QorexState;
  qorexError: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  sender: SenderAccount | null;
  links: StoredLink[];
  refreshLinks: () => void;
  createBrowser: () => void;
  restore: (key: string) => void;
  forget: () => void;
  canLinkExisting: boolean;
  linkExisting: () => void;
}
const AccountCtx = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<QorexIdentity | null>(null);
  const [qorexState, setQ] = useState<QorexState>('checking');
  const [qorexError, setErr] = useState<string | null>(null);
  const [sender, setSender] = useState<SenderAccount | null>(() => loadSender());
  const [links, setLinks] = useState<StoredLink[]>(() => loadLinks());
  const [anon, setAnon] = useState<string | null>(null);

  const reload = useCallback((id: QorexIdentity | null) => {
    setOwner(id ? id.cosmos : null);
    setSender(loadSender()); setLinks(loadLinks()); setAnon(anonymousKey());
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const id = await restoreQorex();
      if (!live) return;
      if (id) { setIdentity(id); setQ('connected'); reload(id); return; }
      setQ((await detectQorex(600)) ? 'ready' : 'missing');
    })();
    return () => { live = false; };
  }, [reload]);

  const connect = useCallback(async () => {
    setQ('connecting'); setErr(null);
    try { const id = await connectQorex(); setIdentity(id); setQ('connected'); reload(id); }
    catch (e) { setErr((e as Error).message); setQ((await detectQorex(300)) ? 'ready' : 'missing'); }
  }, [reload]);
  const disconnect = useCallback(() => { forgetQorex(); setIdentity(null); setQ('ready'); reload(null); }, [reload]);

  const value = useMemo<Ctx>(() => ({
    identity, qorexState, qorexError, connect, disconnect, sender, links,
    refreshLinks: () => setLinks(loadLinks()),
    createBrowser: () => { setSender(createSender()); },
    restore: (k) => { setSender(importSender(k)); setLinks(loadLinks()); },
    forget: () => { forgetSender(); setSender(null); },
    canLinkExisting: !!identity && !sender && !!anon,
    linkExisting: () => { const s = linkAnonymousToOwner(); if (s) { setSender(s); setLinks(loadLinks()); } },
  }), [identity, qorexState, qorexError, connect, disconnect, sender, links, anon]);
  return <AccountCtx.Provider value={value}>{children}</AccountCtx.Provider>;
}

export function useAccount(): Ctx {
  const c = useContext(AccountCtx);
  if (!c) throw new Error('AccountProvider missing');
  return c;
}

/** Live balance + "active" (registered key and an open scoped window) for the Pocket signing account. */
export function usePocket() {
  const { sender } = useAccount();
  const { data: balance } = useBalance(sender?.address);
  const { data: win, refetch } = useQuery({
    queryKey: ['swin', sender?.address], enabled: !!sender, refetchInterval: 10_000,
    queryFn: async () => (await import('./recipient')).senderWindow(hexToBytes(exportSenderKey()!)),
  });
  const active = !!win && win.live && win.remainingTxs > 0n && win.remainingValue > 700_000n;
  return { balance, win, active, winKnown: win !== undefined, refetchWin: () => void refetch(), funded: (balance ?? 0n) >= 400_000_000_000_000_000n, remainingUqor: win?.remainingValue };
}

export function useQorexBalance() {
  const { identity } = useAccount();
  return useQuery({ queryKey: ['qorex-balance', identity?.cosmos], enabled: !!identity, refetchInterval: 8000, queryFn: () => qorexBalanceWei(identity!) });
}
