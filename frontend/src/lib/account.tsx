import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Hex } from 'viem';
import { createRoot, deriveAccount, forgetRoot, importRoot, loadRoot, ROOT_EVENT, ROOT_STORAGE_KEY, type KeyAccount } from './identity';
import { connectQorex, detectQorex, forgetQorex, qorexBalanceWei, restoreQorex, type QorexIdentity } from './qorex';
import { useBalance } from './queries';
import { defaultCfg, loadEnv, predictPocket, readPocket, saveEnv, type Env, type PocketCfg, type PocketView } from './v4';
import { keyStatus, type KeyStatus } from './claim4';
import type { Ctx as ActionCtx } from './actions';

type QorexState = 'checking' | 'missing' | 'ready' | 'connecting' | 'connected';
interface Ctx {
  env: Env;
  setEnv: (e: Env) => void;
  /** The browser key (root). */
  root: string | null;
  acct: KeyAccount | null;
  createKey: () => void;
  /** Replaces the key only with `replace: true` (the UI asks first when the current key may own funds). */
  restoreKey: (hex: string, opts?: { replace?: boolean }) => void;
  /** Returns this browser's key, creating it only if none exists, and makes the whole app use it. */
  ensureKey: () => string;
  forgetKey: () => void;
  /** The counterfactual Pocket of the key account in the current instance (shown everywhere as "Your Pocket"). */
  cfg: PocketCfg | null;
  pocket: Hex | null;
  /** Everything an action needs: instance, Pocket config, address and the signing key. */
  actionCtx: ActionCtx | null;
  /** Pockets this key owns besides the primary one (for example one it took over by recovery). */
  adopted: Hex[];
  adopt: (a: Hex) => void;
  activePocket: Hex | null;
  setActivePocket: (a: Hex) => void;
  identity: QorexIdentity | null;
  qorexState: QorexState;
  qorexError: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}
const AccountCtx = createContext<Ctx | null>(null);

const ADOPT_KEY = 'pd.adopted.v4';
const ACTIVE_KEY = 'pd.active.v4';
const loadActive = (): Hex | null => { try { const v = localStorage.getItem(ACTIVE_KEY); return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Hex) : null; } catch { return null; } };
const saveActive = (a: Hex | null) => { try { if (a) localStorage.setItem(ACTIVE_KEY, a); else localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ } };
const loadAdopted = (): Hex[] => { try { return JSON.parse(localStorage.getItem(ADOPT_KEY) || '[]'); } catch { return []; } };

export function AccountProvider({ children }: { children: ReactNode }) {
  const [env, setEnvState] = useState<Env>(() => loadEnv());
  const [root, setRoot] = useState<string | null>(() => loadRoot());
  const [acct, setAcct] = useState<KeyAccount | null>(null);
  const [pocket, setPocket] = useState<Hex | null>(null);
  const [adopted, setAdopted] = useState<Hex[]>(() => loadAdopted());
  const [active, setActiveState] = useState<Hex | null>(() => loadActive());
  const setActive = useCallback((a: Hex | null) => { saveActive(a); setActiveState(a); }, []);
  const [identity, setIdentity] = useState<QorexIdentity | null>(null);
  const [qorexState, setQ] = useState<QorexState>('checking');
  const [qorexError, setErr] = useState<string | null>(null);

  const cfg = useMemo(() => (acct ? defaultCfg(acct.evm as Hex) : null), [acct]);

  // follow the stored key when another page of this tab (claim) or another tab changes it
  useEffect(() => {
    const sync = () => setRoot((cur) => { const r = loadRoot(); return r === cur ? cur : r; });
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === ROOT_STORAGE_KEY) sync(); };
    window.addEventListener(ROOT_EVENT, sync);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', sync);
    return () => { window.removeEventListener(ROOT_EVENT, sync); window.removeEventListener('storage', onStorage); window.removeEventListener('focus', sync); };
  }, []);

  useEffect(() => {
    let live = true;
    setAcct(null);
    if (root) void deriveAccount(root).then((a) => { if (live) setAcct(a); }).catch(() => undefined);
    return () => { live = false; };
  }, [root]);

  useEffect(() => {
    let live = true;
    setPocket(null);
    if (cfg) void predictPocket(env, cfg).then((p) => { if (live) setPocket(p); }).catch(() => undefined);
    return () => { live = false; };
  }, [cfg, env]);

  useEffect(() => {
    let live = true;
    (async () => {
      const id = await restoreQorex();
      if (!live) return;
      if (id) { setIdentity(id); setQ('connected'); return; }
      setQ((await detectQorex(600)) ? 'ready' : 'missing');
    })();
    return () => { live = false; };
  }, []);

  const ensureKey = useCallback(() => { const r = createRoot(); setRoot(r); return r; }, []);

  const connect = useCallback(async () => {
    setQ('connecting'); setErr(null);
    try { const id = await connectQorex(); setIdentity(id); setQ('connected'); }
    catch (e) { setErr((e as Error).message); setQ((await detectQorex(300)) ? 'ready' : 'missing'); }
  }, []);

  const value = useMemo<Ctx>(() => {
    const activePocket = active && (active === pocket || adopted.includes(active)) ? active : pocket;
    return {
      env, setEnv: (e) => { saveEnv(e); setEnvState(e); setActive(null); },
      root, acct,
      createKey: () => setRoot(createRoot()),
      ensureKey,
      restoreKey: (h, o) => setRoot(importRoot(h, o)),
      forgetKey: () => { forgetRoot(); setRoot(null); setActive(null); },
      cfg, pocket,
      actionCtx: acct && cfg && activePocket ? { env, cfg, address: activePocket, acct } : null,
      adopted,
      adopt: (a) => { const n = [...new Set([...adopted, a])]; try { localStorage.setItem(ADOPT_KEY, JSON.stringify(n)); } catch { /* ignore */ } setAdopted(n); setActive(a); },
      activePocket, setActivePocket: setActive,
      identity, qorexState, qorexError, connect,
      disconnect: () => { forgetQorex(); setIdentity(null); setQ('ready'); },
    };
  }, [env, root, acct, cfg, pocket, adopted, active, identity, qorexState, qorexError, connect, setActive, ensureKey]);
  return <AccountCtx.Provider value={value}>{children}</AccountCtx.Provider>;
}

export function useAccount(): Ctx {
  const c = useContext(AccountCtx);
  if (!c) throw new Error('AccountProvider missing');
  return c;
}

/** Live read of the active Pocket (balance, limit, queue, guardians, freeze, recovery). */
export function usePocketView() {
  const { env, activePocket } = useAccount();
  return useQuery<PocketView>({ queryKey: ['pocket', env, activePocket], enabled: !!activePocket, refetchInterval: 6000, queryFn: () => readPocket(env, activePocket as Hex) });
}

/** Live balance and PQ registration of the key account (the one that owns the Pocket). */
export function useKeyAccount() {
  const { acct } = useAccount();
  const { data: balance } = useBalance(acct?.evm as Hex | undefined);
  const { data: status, refetch } = useQuery<KeyStatus>({ queryKey: ['keystatus', acct?.evm], enabled: !!acct, refetchInterval: 8000, queryFn: () => keyStatus(acct!.evm as Hex) });
  return { balance, status, ready: !!status && status.registered && status.possessionProven && status.algoId === 1, refetch };
}

export function useQorexBalance() {
  const { identity } = useAccount();
  return useQuery({ queryKey: ['qorex-balance', identity?.cosmos], enabled: !!identity, refetchInterval: 8000, queryFn: () => qorexBalanceWei(identity!) });
}
