// Pocket Drop v4 on Diana testnet: instances, the Pocket config model, chain reads and the relay call.
import { encodeFunctionData, parseEther, parseEventLogs, type Hex, type Log } from 'viem';
import data from '../data/v4.json';
import { dropAbi, factoryAbi, poolAbi, vaultAbi } from './abi4';
import { pub } from './chain';
import { postRoute, type RouteResult } from './api';

/** prod / lab = the CURRENT contracts (v5.1, 26 Nov 2026). prodV5 / labV5 = the v5 contracts and prodV4 / labV4 = the v4
 *  contracts (history, old links, Pockets made on them). New Pockets, drops and pools are always made on the current contracts. */
export type Env = 'prod' | 'lab' | 'prodV5' | 'labV5' | 'prodV4' | 'labV4';
export const CURRENT_ENVS = ['prod', 'lab'] as const satisfies readonly Env[];
export const PREVIOUS_ENVS = ['prodV5', 'labV5', 'prodV4', 'labV4'] as const satisfies readonly Env[];
export const ALL_ENVS: Env[] = [...CURRENT_ENVS, ...PREVIOUS_ENVS];
/** Link id prefixes: r / m = v5.1 prod / lab, q / k = v5, p / l = v4 (links shared before v5.1 keep their prefix). */
export const LINK_PREFIX: Record<Env, string> = { prod: 'r', lab: 'm', prodV5: 'q', labV5: 'k', prodV4: 'p', labV4: 'l' };
export const CURRENT_VERSION = 'v5.1';
export type Gen = 'v5.1' | 'v5' | 'v4';
export const genOf = (e: Env): Gen => (e === 'prod' || e === 'lab' ? 'v5.1' : e === 'prodV5' || e === 'labV5' ? 'v5' : 'v4');
/** v5.1 binds sign `feeTo` (the address paid the delivery fee); v5 and v4 binds do not. */
export const bindSignsFeeTo = (e: Env) => genOf(e) === 'v5.1';
/** The previous generation of a current env: where a user's Pocket from before v5.1 lives. */
export const previousOf = (e: Env): Env => (e === 'prod' ? 'prodV5' : e === 'lab' ? 'labV5' : e);
export const isProdLike = (e: Env) => e === 'prod' || e === 'prodV5' || e === 'prodV4';
/** The current-generation instance of the same kind: where new Pockets live and where payouts from old links should land. */
export const currentOf = (e: Env): 'prod' | 'lab' => (isProdLike(e) ? 'prod' : 'lab');
export const envLabel = (e: Env) => `${isProdLike(e) ? 'production' : 'lab'} (${genOf(e)}${genOf(e) === 'v5.1' ? '' : ', previous contracts'})`;
const addr = (x: string) => x as Hex;
const mk = (e: Env) => {
  const i = data.instances[e];
  return {
    env: e,
    router: addr(i.router.address), factory: addr(i.factory.address), drop: addr(i.drop.address), pool: addr(i.pool.address), vaultImpl: addr(i.vaultImpl.address),
    dropFromBlock: BigInt(i.drop.blockNumber), poolFromBlock: BigInt(i.pool.blockNumber),
    timelockSec: Number(i.readBack.TIMELOCK), recoverySec: Number(i.readBack.RECOVERY_DELAY), freezeSec: Number(i.readBack.FREEZE_PERIOD),
    unanimousSec: Number(i.readBack.UNANIMOUS_RECOVERY_DELAY), bindTimeoutSec: Number(i.readBack.BIND_TIMEOUT),
    minEscrow: BigInt(i.dropLimits[0]), maxAmount: BigInt(i.dropLimits[1]), maxDrip: BigInt(i.dropLimits[2]),
    minPerSlot: BigInt(i.poolLimits[0]), maxPerSlot: BigInt(i.poolLimits[1]), maxSlots: Number(i.poolLimits[2]),
  };
};
export const INST = { prod: mk('prod'), lab: mk('lab'), prodV5: mk('prodV5'), labV5: mk('labV5'), prodV4: mk('prodV4'), labV4: mk('labV4') } as const;
export type Inst = (typeof INST)[Env];

/** Drip must cover the newcomer's PQ registration fee (0.06 QOR) with margin. The delivery fee (relayerFee) is per mode, from measured relay costs: lib/fees.ts. */
export const DEFAULTS = { drip: parseEther('0.1'), dailyLimit: parseEther('5'), ttlSeconds: 7 * 86400 } as const;
export const REGISTRATION_FEE_WEI = parseEther('0.06');
export const ZERO_SALT = ('0x' + '00'.repeat(32)) as Hex;
export const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as Hex;

const ENV_KEY = 'pd.env.v4';
export function loadEnv(): Env {
  try {
    const q = new URLSearchParams(window.location.search).get('env');
    if (q === 'lab' || q === 'prod') { localStorage.setItem(ENV_KEY, q); return q; }
    return localStorage.getItem(ENV_KEY) === 'lab' ? 'lab' : 'prod';
  } catch { return 'prod'; }
}
export function saveEnv(e: Env) { try { localStorage.setItem(ENV_KEY, e); } catch { /* private mode */ } }

/** The counterfactual Pocket of an owner. Its address commits to this whole config, so it never changes later:
 *  guardians and the limit are changed after deployment by owner intents (guardian changes sit behind the timelock). */
export interface PocketCfg { owner: Hex; guardians: Hex[]; threshold: number; limit: bigint; userSalt: Hex }
export const defaultCfg = (owner: Hex): PocketCfg => ({ owner, guardians: [], threshold: 0, limit: DEFAULTS.dailyLimit, userSalt: ZERO_SALT });
const cfgArgs = (c: PocketCfg) => [c.owner, c.guardians, c.threshold, c.limit, c.userSalt] as const;

export const predictPocket = (env: Env, c: PocketCfg) =>
  pub.readContract({ address: INST[env].factory, abi: factoryAbi, functionName: 'predict', args: cfgArgs(c) }) as Promise<Hex>;
export const hasCode = async (a: Hex) => ((await pub.getCode({ address: a })) ?? '0x') !== '0x';
export const chainTimestamp = async () => Number((await pub.getBlock()).timestamp);

export interface Queued { id: number; to: Hex; unlockAt: number; epoch: number; state: 'None' | 'Pending' | 'Executed' | 'Vetoed'; amount: bigint }
export interface PocketView {
  address: Hex; env: Env; deployed: boolean; balance: bigint;
  owner: Hex | null; nonce: bigint; dailyLimit: bigint; allowanceLeft: bigint;
  guardians: Hex[]; threshold: number; frozen: boolean; frozenUntil: number; freezeNonce: bigint; freezeStreak: number;
  queue: Queued[]; pendingLimit: bigint; pendingLimitAt: number; pendingGuardians: Hex[]; pendingThreshold: number; pendingGuardiansAt: number;
  recovery: { newOwner: Hex; keyHash: Hex; at: number } | null; unanimous: { newOwner: Hex; keyHash: Hex; at: number } | null;
  recoveryNonce: bigint;
}

const Q_STATES = ['None', 'Pending', 'Executed', 'Vetoed'] as const;

/** Everything the Pocket page shows, read from the chain (LIVE). An undeployed Pocket reads as an empty vault with a balance. */
export async function readPocket(env: Env, address: Hex): Promise<PocketView> {
  const balance = await pub.getBalance({ address });
  const deployed = await hasCode(address);
  const empty: PocketView = {
    address, env, deployed, balance, owner: null, nonce: 0n, dailyLimit: 0n, allowanceLeft: 0n, guardians: [], threshold: 0, frozen: false, frozenUntil: 0,
    freezeNonce: 0n, freezeStreak: 0, queue: [], pendingLimit: 0n, pendingLimitAt: 0, pendingGuardians: [], pendingThreshold: 0, pendingGuardiansAt: 0,
    recovery: null, unanimous: null, recoveryNonce: 0n,
  };
  if (!deployed) return empty;
  const r = <T,>(fn: string, args: unknown[] = []) => pub.readContract({ address, abi: vaultAbi, functionName: fn, args } as never) as Promise<T>;
  const [owner, nonce, dailyLimit, allowanceLeft, guardians, threshold, frozen, frozenUntil, freezeNonce, freezeStreak, queueCount, pendingLimit, pendingLimitAt,
    pendingGuardians, pendingThreshold, pendingGuardiansAt, recoveryOwner, recoveryKeyHash, recoveryAt, uOwner, uKeyHash, uAt, recoveryNonce] = await Promise.all([
    r<Hex>('owner'), r<bigint>('nonce'), r<bigint>('dailyLimit'), r<bigint>('allowanceLeft'), r<Hex[]>('guardians'), r<number>('threshold'), r<boolean>('frozen'),
    r<bigint>('frozenUntil'), r<bigint>('freezeNonce'), r<number>('freezeStreak'), r<bigint>('queueCount'), r<bigint>('pendingLimit'), r<bigint>('pendingLimitAt'),
    r<Hex[]>('pendingGuardians'), r<number>('pendingThreshold'), r<bigint>('pendingGuardiansAt'), r<Hex>('recoveryOwner'), r<Hex>('recoveryKeyHash'), r<bigint>('recoveryAt'),
    r<Hex>('uRecoveryOwner'), r<Hex>('uRecoveryKeyHash'), r<bigint>('uRecoveryAt'), r<bigint>('recoveryNonce'),
  ]);
  const queue: Queued[] = [];
  const n = Number(queueCount);
  const ids = Array.from({ length: Math.min(n, 20) }, (_, i) => n - i).filter((x) => x > 0);
  const items = await Promise.all(ids.map((id) => r<{ to: Hex; unlockAt: bigint; epoch: number; state: number; amount: bigint }>('getQueued', [BigInt(id)])));
  items.forEach((q, i) => queue.push({ id: ids[i], to: q.to, unlockAt: Number(q.unlockAt), epoch: Number(q.epoch), state: Q_STATES[Number(q.state)] ?? 'None', amount: q.amount }));
  return {
    address, env, deployed, balance, owner, nonce, dailyLimit, allowanceLeft, guardians, threshold: Number(threshold), frozen, frozenUntil: Number(frozenUntil),
    freezeNonce, freezeStreak: Number(freezeStreak), queue, pendingLimit, pendingLimitAt: Number(pendingLimitAt), pendingGuardians, pendingThreshold: Number(pendingThreshold),
    pendingGuardiansAt: Number(pendingGuardiansAt),
    recovery: Number(recoveryAt) ? { newOwner: recoveryOwner, keyHash: recoveryKeyHash, at: Number(recoveryAt) } : null,
    unanimous: Number(uAt) ? { newOwner: uOwner, keyHash: uKeyHash, at: Number(uAt) } : null,
    recoveryNonce,
  };
}

/** Owner-signed intent nonce: 0 for an undeployed Pocket, otherwise the vault's `nonce()`. */
export async function nextNonce(address: Hex): Promise<bigint> {
  if (!(await hasCode(address))) return 0n;
  return (await pub.readContract({ address, abi: vaultAbi, functionName: 'nonce' })) as bigint;
}

/** Encode a PocketVault call. */
export const vaultCall = (functionName: string, args: unknown[]): Hex => encodeFunctionData({ abi: vaultAbi, functionName, args } as never);
export const dropCall = (functionName: string, args: unknown[]): Hex => encodeFunctionData({ abi: dropAbi, functionName, args } as never);
export const poolCall = (functionName: string, args: unknown[]): Hex => encodeFunctionData({ abi: poolAbi, functionName, args } as never);

/** Relay calldata for `target` through PocketRouter via /api/route. If the Pocket is not deployed yet, the router deploys it first (lazy deployment). */
export async function relayToPocket(env: Env, cfg: PocketCfg, pocket: Hex, data: Hex): Promise<RouteResult> {
  if (await hasCode(pocket)) return postRoute({ env, target: pocket, data });
  return postRoute({ env, pocket: { owner: cfg.owner, guardians: cfg.guardians, threshold: cfg.threshold, dailyLimit: cfg.limit.toString(), userSalt: cfg.userSalt }, data });
}
export const relayTo = (env: Env, target: Hex, data: Hex): Promise<RouteResult> => postRoute({ env, target, data });

/**
 * The id a create returned: from the router's return value for a hybrid relay (it leaves no EVM log), else from the
 * LinkCreated / PoolCreated log of the EVM receipt.
 */
export async function createdId(res: RouteResult, kind: 'drop' | 'pool'): Promise<bigint> {
  const fromReturn = kind === 'drop' ? res.result?.linkId : res.result?.poolId;
  if (fromReturn && /^\d+$/.test(fromReturn)) return BigInt(fromReturn);
  if (!/^0x[0-9a-fA-F]{64}$/.test(res.txHash)) throw new Error(`The ${kind} was created but its id was not returned.`);
  const ev = await receiptEvents(res.txHash);
  const hit = kind === 'drop'
    ? (ev.drop.find((e) => e.eventName === 'LinkCreated') as { args: { linkId: bigint } } | undefined)?.args.linkId
    : (ev.pool.find((e) => e.eventName === 'PoolCreated') as { args: { poolId: bigint } } | undefined)?.args.poolId;
  if (hit === undefined) throw new Error(`The ${kind} was created but its ${kind === 'drop' ? 'LinkCreated' : 'PoolCreated'} event was not found.`);
  return hit;
}

/** Receipt logs of a relayed tx, decoded with the v4 ABIs. */
export async function receiptEvents(hash: Hex) {
  const rc = await pub.getTransactionReceipt({ hash });
  const logs = rc.logs as Log[];
  return {
    drop: parseEventLogs({ abi: dropAbi, logs }),
    pool: parseEventLogs({ abi: poolAbi, logs }),
  };
}
