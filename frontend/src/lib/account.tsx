import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Hex } from 'viem';
import { createRoot, deriveAccount, forgetRoot, importRoot, loadRoot, type KeyAccount } from './identity';
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
  restoreKey: (hex: string) => void;
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
const loadAdopted = (): Hex[] => { try { return JSON.parse(localStorage.getItem(ADOPT_KEY) || '[]'); } catch { return []; } };

export function AccountProvider({ children }: { children: ReactNode }) {
  const [env, setEnvState] = useState<Env>(() => loadEnv());
  const [root, setRoot] = useState<string | null>(() => loadRoot());
  const [acct, setAcct] = useState<KeyAccount | null>(null);
  const [pocket, setPocket] = useState<Hex | null>(null);
  const [adopted, setAdopted] = useState<Hex[]>(() => loadAdopted());
  const [active, setActive] = useState<Hex | null>(null);
  const [identity, setIdentity] = useState<QorexIdentity | null>(null);
  const [qorexState, setQ] = useState<QorexState>('checking');
  const [qorexError, setErr] = useState<string | null>(null);

  const cfg = useMemo(() => (acct ? defaultCfg(acct.evm as Hex) : null), [acct]);

  useEffect(() => {
    let live = true;
    setAcct(null);
    if (root) void deriveAccount(root).then((a) => { if (live) setAcct(a); });
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
      restoreKey: (h) => setRoot(importRoot(h)),
      forgetKey: () => { forgetRoot(); setRoot(null); setActive(null); },
      cfg, pocket,
      actionCtx: acct && cfg && activePocket ? { env, cfg, address: activePocket, acct } : null,
      adopted,
      adopt: (a) => { const n = [...new Set([...adopted, a])]; try { localStorage.setItem(ADOPT_KEY, JSON.stringify(n)); } catch { /* ignore */ } setAdopted(n); setActive(a); },
      activePocket, setActivePocket: setActive,
      identity, qorexState, qorexError, connect,
      disconnect: () => { forgetQorex(); setIdentity(null); setQ('ready'); },
    };
  }, [env, root, acct, cfg, pocket, adopted, active, identity, qorexState, qorexError, connect]);
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
