// "Check a transaction": fetch a Pocket Drop v4 transaction from the chain, decode the router call and re-verify every
// ML-DSA-87 signature inside it in the browser, with the public keys read from the chain. Nothing here trusts our API:
// the tx comes from Cosmos REST (native hybrid lane) or EVM JSON-RPC, keys from the PQC precompile, state from eth_call.
import { decodeFunctionData, keccak256, type Hex } from 'viem';
import { BIND_V5_ABI } from './claim4';
import { dropAbi, factoryAbi, poolAbi, routerAbi, vaultAbi } from './abi4';
import { ACT, CHAIN_STR, dropBindDigest, dropClaimDigest, finalizeDigest, freezeDigest, intentDigest, params, poolClaimDigest, poolLinkDigest, pqMessageBytes, pqMessageText, recoveryDigest } from './intents';
import { INST, type Env } from './v4';

export type Lane = 'hybrid' | 'evm';

/** The transaction as the chain returned it, reduced to what the checker needs. */
export interface FetchedTx {
  lane: Lane; hash: string; height: bigint; ok: boolean; router: Hex; payload: Hex;
  /** native lane: the chain's own pqc_hybrid_verify event for the relayer's signature. */
  relayerHybridVerified?: boolean; relayer: string; memo?: string;
}

export type Who = 'owner' | 'guardian' | 'link key' | 'recipient' | 'authorizer';
export interface SigCheck {
  who: Who; signer: Hex; fn: string; digest: Hex; message: string;
  keySource: 'chain' | 'calldata'; pkBytes: number; sigBytes: number;
  /** keccak(pk) equals the hash pinned on chain (Pocket owner key, link key hash). null = nothing pinned to compare. */
  pinned: boolean | null;
  valid: boolean;
  /** The same signature checked against the same intent with the next nonce (owner intents) or a changed payout (link/recipient). */
  tamperedValid: boolean; tamperedWhat: string;
  nonce?: bigint;
  /** Second, independent implementation: @qorechain/qoresign (the message format QoreX signs). null = not run. */
  qoresign: { sameText: boolean; valid: boolean } | null;
}

export interface Report {
  tx: FetchedTx; env: Env | null; action: string; target: Hex | null; fn: string | null; args: Record<string, string>;
  checks: SigCheck[];
  /** Why nothing was checked, when `checks` is empty. */
  note?: string;
}

/** Chain reads the checker needs (injected so tests run against recorded data). `block` = read state at that height. */
export interface CheckDeps {
  fetchTx(hash: string): Promise<FetchedTx>;
  read(address: Hex, abi: unknown, functionName: string, args: unknown[], block?: bigint): Promise<unknown>;
  hasCode(address: Hex, block?: bigint): Promise<boolean>;
  /** Registered ML-DSA-87 public key of an account (PQC precompile 0x...0a02), or null. */
  keyOf(address: Hex): Promise<Hex | null>;
  verify(pk: Uint8Array, message: Uint8Array, sig: Uint8Array): Promise<boolean> | boolean;
  /** Optional cross-check with @qorechain/qoresign: its message bytes for (chain, digest text) and its ML-DSA verify. */
  qoresign?: { messageBytes(chainId: string, data: string): Uint8Array; verify(pk: Uint8Array, message: Uint8Array, sig: Uint8Array): boolean };
}

export const isNativeHash = (h: string) => /^[0-9a-fA-F]{64}$/.test(h);
export const isEvmHash = (h: string) => /^0x[0-9a-fA-F]{64}$/.test(h);
export const normalizeHash = (h: string): string | null => {
  const t = h.trim();
  if (isEvmHash(t)) return t.toLowerCase();
  if (isNativeHash(t)) return t.toUpperCase();
  return null;
};

const hexBytes = (h: Hex): Uint8Array => { const s = h.slice(2); const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16); return o; };
export const b64ToHex = (b64: string): Hex => { const bin = atob(b64); let s = '0x'; for (let i = 0; i < bin.length; i++) s += bin.charCodeAt(i).toString(16).padStart(2, '0'); return s as Hex; };
const envOfRouter = (router: Hex): Env | null => (Object.keys(INST) as Env[]).find((e) => INST[e].router.toLowerCase() === router.toLowerCase()) ?? null;

/** Native-lane tx JSON (Cosmos REST /cosmos/tx/v1beta1/txs/{hash}) -> FetchedTx, or null when it is not a router call. */
export function fromCosmosTx(j: { tx_response?: { txhash: string; height: string; code: number; events?: { type: string; attributes: { key: string; value: string }[] }[]; tx?: { body?: { memo?: string; messages?: Record<string, unknown>[] } } } }): FetchedTx | null {
  const r = j.tx_response;
  if (!r) return null;
  const m = (r.tx?.body?.messages ?? []).find((x) => x['@type'] === '/qorechain.crossvm.v1.MsgCrossVMCall');
  if (!m) return null;
  const hy = (r.events ?? []).find((e) => e.type === 'pqc_hybrid_verify');
  return {
    lane: 'hybrid', hash: r.txhash, height: BigInt(r.height), ok: r.code === 0,
    router: String(m.target_contract ?? '') as Hex, payload: b64ToHex(String(m.payload ?? '')),
    relayerHybridVerified: !!hy && hy.attributes.some((a) => a.key === 'status' && a.value === 'verified'),
    relayer: String(m.sender ?? ''), memo: r.tx?.body?.memo ?? '',
  };
}

type Call = { functionName: string; args: readonly unknown[] };
const tryDecode = (abi: unknown, data: Hex): Call | null => { try { return decodeFunctionData({ abi: abi as never, data }) as Call; } catch { return null; } };
const str = (v: unknown): string => (Array.isArray(v) ? `[${v.map(str).join(', ')}]` : typeof v === 'bigint' ? v.toString() : String(v));
const short = (h: string) => (h.length > 22 ? `${h.slice(0, 10)}…${h.slice(-6)} (${(h.length - 2) / 2} bytes)` : h);

/** Owner intent functions on PocketVault: action tag and abi-encoded params from the decoded args (sig is last, deadline before it). */
const OWNER_INTENTS: Record<string, (a: readonly unknown[]) => { action: Hex; params: Hex; tamper: Hex | null; tamperWhat: string }> = {
  spend: (a) => ({ action: ACT.SPEND, params: params.spend(a[0] as Hex, a[1] as bigint), tamper: params.spend(a[0] as Hex, (a[1] as bigint) + 1n), tamperWhat: 'amount + 1 wei' }),
  setLimit: (a) => ({ action: ACT.SET_LIMIT, params: params.limit(a[0] as bigint), tamper: params.limit((a[0] as bigint) + 1n), tamperWhat: 'limit + 1 wei' }),
  vetoQueued: (a) => ({ action: ACT.VETO_QUEUED, params: params.id(a[0] as bigint), tamper: params.id((a[0] as bigint) + 1n), tamperWhat: 'queued id + 1' }),
  setGuardians: (a) => ({ action: ACT.SET_GUARDIANS, params: params.guardians(a[0] as Hex[], Number(a[1])), tamper: null, tamperWhat: '' }),
  cancelPending: () => ({ action: ACT.CANCEL_PENDING, params: params.none(), tamper: null, tamperWhat: '' }),
  vetoRecovery: () => ({ action: ACT.VETO_RECOVERY, params: params.none(), tamper: null, tamperWhat: '' }),
  createDrop: (a) => ({
    action: ACT.CREATE_DROP,
    params: params.createDrop(a[0] as Hex, a[1] as Hex, Number(a[2]), a[3] as bigint, a[4] as bigint, a[5] as bigint, a[6] as bigint),
    tamper: params.createDrop(a[0] as Hex, a[1] as Hex, Number(a[2]), a[3] as bigint, a[4] as bigint, a[5] as bigint, (a[6] as bigint) + 1n), tamperWhat: 'value + 1 wei',
  }),
  confirmDrop: (a) => ({ action: ACT.CONFIRM_DROP, params: params.confirm(a[0] as Hex, a[1] as bigint, a[2] as Hex), tamper: params.confirm(a[0] as Hex, (a[1] as bigint) + 1n, a[2] as Hex), tamperWhat: 'link id + 1' }),
  cancelDrop: (a) => ({ action: ACT.CANCEL_DROP, params: params.cancel(a[0] as Hex, a[1] as bigint), tamper: params.cancel(a[0] as Hex, (a[1] as bigint) + 1n), tamperWhat: 'link id + 1' }),
  createPool: (a) => ({
    action: ACT.CREATE_POOL, params: params.createPool(a[0] as Hex, a[1] as Hex, Number(a[2]), a[3] as bigint, a[4] as bigint),
    tamper: params.createPool(a[0] as Hex, a[1] as Hex, Number(a[2]), (a[3] as bigint) + 1n, a[4] as bigint), tamperWhat: 'per-slot + 1 wei',
  }),
  closePool: (a) => ({ action: ACT.CLOSE_POOL, params: params.closePool(a[0] as Hex, a[1] as bigint), tamper: params.closePool(a[0] as Hex, (a[1] as bigint) + 1n), tamperWhat: 'pool id + 1' }),
};

interface SigInput { who: Who; signer: Hex; fn: string; digest: Hex; tampered: Hex; tamperedWhat: string; pk: Hex | null; keySource: 'chain' | 'calldata'; pinnedHash: Hex | null; sig: Hex; nonce?: bigint }

async function runCheck(d: CheckDeps, s: SigInput): Promise<SigCheck> {
  const sig = hexBytes(s.sig);
  const base = { who: s.who, signer: s.signer, fn: s.fn, digest: s.digest, message: pqMessageText(s.digest), keySource: s.keySource, sigBytes: sig.length, nonce: s.nonce, tamperedWhat: s.tamperedWhat };
  if (!s.pk) return { ...base, pkBytes: 0, pinned: null, valid: false, tamperedValid: false, qoresign: null };
  const pk = hexBytes(s.pk);
  const valid = await d.verify(pk, pqMessageBytes(s.digest), sig);
  const tamperedValid = await d.verify(pk, pqMessageBytes(s.tampered), sig);
  let qoresign: SigCheck['qoresign'] = null;
  if (d.qoresign) {
    const ours = pqMessageBytes(s.digest);
    const theirs = d.qoresign.messageBytes(CHAIN_STR, s.digest.toLowerCase());
    const sameText = ours.length === theirs.length && ours.every((b, i) => b === theirs[i]);
    let ok = false; try { ok = d.qoresign.verify(pk, theirs, sig); } catch { ok = false; }
    qoresign = { sameText, valid: ok };
  }
  return { ...base, pkBytes: pk.length, pinned: s.pinnedHash ? keccak256(s.pk).toLowerCase() === s.pinnedHash.toLowerCase() : null, valid, tamperedValid, qoresign };
}

/** Nonce the owner signed: the Pocket's nonce just before the tx (0 when this tx deployed it). */
async function nonceBefore(d: CheckDeps, vault: Hex, height: bigint): Promise<bigint> {
  if (!(await d.hasCode(vault, height - 1n))) return 0n;
  return (await d.read(vault, vaultAbi, 'nonce', [], height - 1n)) as bigint;
}

/** Who sent an EVM-lane transaction: the Pocket Drop relayer, or the account's own scoped EVM window ("Relay it yourself",
 *  a team script, or an attacker trying on its own). The relayer is not the only possible sender: the router has no caller check. */
export function evmSender(from: string | undefined, relayer: string): 'relayer' | 'own' {
  return from && from.toLowerCase() === relayer.toLowerCase() ? 'relayer' : 'own';
}

export async function checkTx(hashIn: string, d: CheckDeps): Promise<Report> {
  const hash = normalizeHash(hashIn);
  if (!hash) throw new Error('Paste a transaction hash: 64 hex characters (native lane) or 0x + 64 hex (EVM).');
  const tx = await d.fetchTx(hash);
  const env = envOfRouter(tx.router);
  const empty = (action: string, note: string, extra: Partial<Report> = {}): Report => ({ tx, env, action, target: null, fn: null, args: {}, checks: [], note, ...extra });
  if (!env) return empty('unknown', 'This transaction does not call a Pocket Drop router (v5.2 or the previous v5.1, v5 and v4), so there is no Pocket intent to check.');
  const inst = INST[env];
  const rc = tryDecode(routerAbi, tx.payload);
  if (!rc) return empty('unknown', 'The router call could not be decoded.');

  let target: Hex; let inner: Hex;
  if (rc.functionName === 'relay') { [target, inner] = rc.args as [Hex, Hex]; }
  else if (rc.functionName === 'deployAndRelay') {
    const [owner, guardians, threshold, limit, salt, data] = rc.args as [Hex, Hex[], number, bigint, Hex, Hex];
    target = (await d.read(inst.factory, factoryAbi, 'predict', [owner, guardians, threshold, limit, salt])) as Hex;
    inner = data;
  } else return empty(rc.functionName, 'Not a relay call.');

  const t = target.toLowerCase();
  const isDrop = t === inst.drop.toLowerCase();
  const isPool = t === inst.pool.toLowerCase();
  const innerAbi = isDrop ? [...dropAbi, ...BIND_V5_ABI] : isPool ? poolAbi : vaultAbi; // drops: v5.1 bind (feeTo) and the v5 / v4 bind
  const call = tryDecode(innerAbi, inner);
  if (!call) return empty(rc.functionName, 'The inner call could not be decoded.', { target });
  const fnAbi = (innerAbi as readonly { type: string; name?: string; inputs?: { name: string }[] }[])
    .find((x) => x.type === 'function' && x.name === call.functionName && (x.inputs?.length ?? -1) === call.args.length);
  const args: Record<string, string> = {};
  (fnAbi?.inputs ?? []).forEach((inp, i) => { const v = str(call.args[i]); args[inp.name || `arg${i}`] = /^0x[0-9a-f]{200,}$/i.test(v) ? short(v) : v; });
  const out: Report = { tx, env, action: rc.functionName, target, fn: call.functionName, args, checks: [] };
  const a = call.args;
  const h = tx.height;

  if (!isDrop && !isPool) {
    const mk = OWNER_INTENTS[call.functionName];
    if (mk) {
      const deadline = a[a.length - 2] as bigint; const sig = a[a.length - 1] as Hex;
      const { action, params: p, tamper, tamperWhat } = mk(a);
      const nonce = await nonceBefore(d, target, h);
      const owner = (await d.read(target, vaultAbi, 'owner', [], h)) as Hex;
      const pinned = (await d.read(target, vaultAbi, 'ownerKeyHash', [], h)) as Hex;
      const digest = intentDigest({ action, vault: target, nonce, deadline, params: p });
      // Without a tampered-param variant the replay check uses the next nonce: a used signature must not authorise again.
      const tampered = tamper ? intentDigest({ action, vault: target, nonce, deadline, params: tamper }) : intentDigest({ action, vault: target, nonce: nonce + 1n, deadline, params: p });
      out.checks.push(await runCheck(d, { who: 'owner', signer: owner, fn: call.functionName, digest, tampered, tamperedWhat: tamper ? tamperWhat : 'next nonce (replay)', pk: await d.keyOf(owner), keySource: 'chain', pinnedHash: pinned, sig, nonce }));
      if (tamper) {
        const replay = intentDigest({ action, vault: target, nonce: nonce + 1n, deadline, params: p });
        const c = await runCheck(d, { who: 'owner', signer: owner, fn: call.functionName, digest: replay, tampered: replay, tamperedWhat: 'next nonce (replay)', pk: await d.keyOf(owner), keySource: 'chain', pinnedHash: pinned, sig, nonce: nonce + 1n });
        out.checks[0].tamperedWhat = `${tamperWhat}; next nonce (replay) ${c.valid ? 'ACCEPTED' : 'rejected'}`;
        out.checks[0].tamperedValid = out.checks[0].tamperedValid || c.valid;
      }
    } else if (call.functionName === 'guardianFreeze') {
      const [signers, sigs, n, deadline] = a as [Hex[], Hex[], bigint, bigint];
      const digest = freezeDigest({ vault: target, nonce: n, deadline });
      const tampered = freezeDigest({ vault: target, nonce: n + 1n, deadline });
      for (let i = 0; i < signers.length; i++) out.checks.push(await runCheck(d, { who: 'guardian', signer: signers[i], fn: 'guardianFreeze', digest, tampered, tamperedWhat: 'next freeze nonce (replay)', pk: await d.keyOf(signers[i]), keySource: 'chain', pinnedHash: null, sig: sigs[i] }));
    } else if (call.functionName === 'proposeRecovery' || call.functionName === 'proposeRecoveryUnanimous') {
      const [newOwner, newKeyHash, deadline, signers, sigs] = a as [Hex, Hex, bigint, Hex[], Hex[]];
      const unanimous = call.functionName === 'proposeRecoveryUnanimous';
      const recNonce = (await d.read(target, vaultAbi, 'recoveryNonce', [], h - 1n)) as bigint;
      const digest = recoveryDigest({ vault: target, recNonce, newOwner, newKeyHash, deadline, unanimous });
      const tampered = recoveryDigest({ vault: target, recNonce, newOwner: target, newKeyHash, deadline, unanimous });
      for (let i = 0; i < signers.length; i++) out.checks.push(await runCheck(d, { who: 'guardian', signer: signers[i], fn: call.functionName, digest, tampered, tamperedWhat: 'a different new owner', pk: await d.keyOf(signers[i]), keySource: 'chain', pinnedHash: null, sig: sigs[i], nonce: recNonce }));
    } else if ((call.functionName === 'finalizeRecovery' || call.functionName === 'finalizeRecoveryUnanimous') && a.length === 3) {
      // v5.2: finishing a recovery carries an ML-DSA-87 authorization from the owner (threshold path only), a guardian or the
      // approved new owner. The signed digest names the pending recovery read from the chain at the block before.
      const [authorizer, deadline, sig] = a as [Hex, bigint, Hex];
      const unanimous = call.functionName === 'finalizeRecoveryUnanimous';
      const [recNonce, newOwner, newKeyHash] = await Promise.all([
        d.read(target, vaultAbi, 'recoveryNonce', [], h - 1n) as Promise<bigint>,
        d.read(target, vaultAbi, unanimous ? 'uRecoveryOwner' : 'recoveryOwner', [], h - 1n) as Promise<Hex>,
        d.read(target, vaultAbi, unanimous ? 'uRecoveryKeyHash' : 'recoveryKeyHash', [], h - 1n) as Promise<Hex>,
      ]);
      const digest = finalizeDigest({ vault: target, unanimous, recNonce, newOwner, newKeyHash, authorizer, deadline });
      const tampered = finalizeDigest({ vault: target, unanimous, recNonce, newOwner: target, newKeyHash, authorizer, deadline });
      out.checks.push(await runCheck(d, { who: 'authorizer', signer: authorizer, fn: call.functionName, digest, tampered, tamperedWhat: 'a different new owner', pk: await d.keyOf(authorizer), keySource: 'chain', pinnedHash: null, sig, nonce: recNonce }));
    } else {
      out.note = `${call.functionName} carries no signature: anyone may call it, and the Pocket's own rules (timelock, delays) decide.`;
    }
    return out;
  }

  if (isDrop && call.functionName === 'bind') {
    const withFee = a.length === 7; // v5.1: (id, recipient, keyHash, payTo, feeTo, linkPk, linkSig)
    const [id, recipient, keyHash, payTo] = a as [bigint, Hex, Hex, Hex];
    const feeTo = withFee ? (a[4] as Hex) : undefined;
    const [linkPk, linkSig] = (withFee ? a.slice(5) : a.slice(4)) as [Hex, Hex];
    const link = (await d.read(inst.drop, dropAbi, 'getLink', [id], h)) as { linkKeyHash: Hex };
    const digest = dropBindDigest({ drop: inst.drop, id, recipient, keyHash, payTo, feeTo });
    const tampered = dropBindDigest({ drop: inst.drop, id, recipient: payTo === recipient ? inst.drop : recipient, keyHash, payTo: inst.drop, feeTo });
    out.checks.push(await runCheck(d, { who: 'link key', signer: recipient, fn: 'bind', digest, tampered, tamperedWhat: 'a different payout address', pk: linkPk, keySource: 'calldata', pinnedHash: link.linkKeyHash, sig: linkSig }));
  } else if (isDrop && call.functionName === 'claim') {
    const [id, sig] = a as [bigint, Hex];
    const link = (await d.read(inst.drop, dropAbi, 'getLink', [id], h)) as { recipient: Hex; payTo: Hex };
    const digest = dropClaimDigest({ drop: inst.drop, id, recipient: link.recipient, payTo: link.payTo });
    const tampered = dropClaimDigest({ drop: inst.drop, id, recipient: link.recipient, payTo: inst.drop });
    out.checks.push(await runCheck(d, { who: 'recipient', signer: link.recipient, fn: 'claim', digest, tampered, tamperedWhat: 'a different payout address', pk: await d.keyOf(link.recipient), keySource: 'chain', pinnedHash: null, sig }));
  } else if (isPool && call.functionName === 'claim') {
    const [id, recipient, payTo, linkPk, linkSig, recipientSig] = a as [bigint, Hex, Hex, Hex, Hex, Hex];
    const pool = (await d.read(inst.pool, poolAbi, 'getPool', [id], h)) as { linkKeyHash: Hex };
    const ld = poolLinkDigest({ pool: inst.pool, id, recipient, payTo });
    const rd = poolClaimDigest({ pool: inst.pool, id, recipient, payTo });
    out.checks.push(await runCheck(d, { who: 'link key', signer: recipient, fn: 'claim', digest: ld, tampered: poolLinkDigest({ pool: inst.pool, id, recipient, payTo: inst.pool }), tamperedWhat: 'a different payout address', pk: linkPk, keySource: 'calldata', pinnedHash: pool.linkKeyHash, sig: linkSig }));
    out.checks.push(await runCheck(d, { who: 'recipient', signer: recipient, fn: 'claim', digest: rd, tampered: poolClaimDigest({ pool: inst.pool, id, recipient, payTo: inst.pool }), tamperedWhat: 'a different payout address', pk: await d.keyOf(recipient), keySource: 'chain', pinnedHash: null, sig: recipientSig }));
  } else {
    out.note = `${call.functionName} carries no signature: anyone may call it, and the contract's own rules decide.`;
  }
  return out;
}

/** Overall verdict for the page header. */
export function verdict(r: Report): 'verified' | 'failed' | 'refused' | 'none' {
  if (!r.checks.length) return 'none';
  const ok = r.checks.every((c) => c.valid && !c.tamperedValid && c.pinned !== false && (c.qoresign === null || (c.qoresign.sameText && c.qoresign.valid)));
  if (ok) return 'verified';
  // A reverted transaction whose signature does not verify is an attempt the contract refused, for the reason shown here.
  return r.tx.ok ? 'failed' : 'refused';
}
