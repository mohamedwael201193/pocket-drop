// The Q-Day Drill, run from the browser. Everything here is read-only (eth_call) unless the visitor
// presses "Put it on chain", which asks our relayer to mine the same call (it only mines calls that revert).
// The classical key never leaves this tab: it signs locally and is never sent to our API.
import { decodeErrorResult, encodeFunctionData, keccak256, parseEther, toHex, zeroAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { dropAbi, errorsAbi, routerAbi, vaultAbi } from './abi4';
import { pub } from './chain';
import { API_BASE } from './config';
import { ACT, intentDigest, params, pqMessageBytes } from './intents';
import data from '../data/qday-baits.json';

export const QDAY = data as unknown as {
  router: Hex; drop: Hex; fromBlock: number;
  baits: { id: string; description: string; keyAccount: Hex; pocket: Hex; config: { owner: Hex; guardians: Hex[]; threshold: number; dailyLimitWei: string; userSalt: Hex }; planned: { drop?: { linkId: string } } | null }[];
  before: { title: string; pocket: Hex; keyAccount: Hex; theftTx: Hex; explain: string }; after: { pocket: Hex; note: string; exampleRevertTx: Hex };
};
export type BaitId = string;
export const SINK = '0x000000000000000000000000000000000000dEaD' as Hex;

export interface LiveBait {
  id: string; description: string; keyAccount: Hex; pocket: Hex; deployed: boolean; classicalKey: Hex | null; pocketWei: string; keyAccountWei: string;
  ownerKeyHash: Hex; liveKeyHash: Hex | null; keyUnchanged: boolean; windowLive: boolean | null; events: { name: string; tx: string; planned: boolean }[]; alarm: string[];
}
export interface AttemptRow { tx: string; height: number; from: string; bait: string; call: string; failed: boolean; error: string | null; source: string; explorer: string; lane?: 'evm' | 'hybrid'; hybridVerified?: boolean; time?: string }

/** The defence that stops a classical-key attacker for each call, in plain words (from the v4 contracts). */
export function defenceFor(call: string): string {
  if (call === 'fund' || call === 'deploy') return 'Harmless: anyone may fund or deploy a Pocket; it moves nothing out.';
  if (call === 'executeQueued') return 'Only pays out a spend the owner queued with an ML-DSA-87 signature, after its timelock.';
  if (call === 'finalizeRecovery' || call === 'finalizeRecoveryUnanimous') return 'Only finishes a recovery the guardians proposed, after the recovery delay.';
  if (call === 'proposeRecovery' || call === 'proposeRecoveryUnanimous' || call === 'guardianFreeze') return 'Needs ML-DSA-87 signatures from the guardians; the bait owner key is not a guardian.';
  if (call.startsWith('drop.')) return 'The drop link pays only the recipient bound with the link\'s and the recipient\'s ML-DSA-87 keys.';
  return 'The Pocket accepts this only with a 4,627-byte ML-DSA-87 signature from the owner\'s registered key; the classical key cannot make one.';
}
const SRC: Record<string, string> = { 'try-it': 'a visitor (Try it)', 'team-bot': 'our attacker bot', anyone: 'anyone', 'team-setup': 'team setup' };
export interface IntruderRow { key: string; when: string | null; height: number | null; bait: string; call: string; who: string; where: 'on chain (EVM)' | 'on chain (hybrid lane)' | 'refused before sending'; result: string; defence: string; tx: string | null }
/** Every refused attempt on one list (the intruder file): mined reverts from any source plus relayer refusals, newest first. */
/** Time and block of one refused row, the same shape on every row: mined rows have both, rows refused before sending were never mined. */
export function whenLine(r: Pick<IntruderRow, 'when' | 'height'>, fmt: (t: string | number) => string): string {
  const t = r.when ? fmt(r.when) : 'time not recorded';
  return `${t} · ${r.height ? `block ${r.height.toLocaleString('en-US')}` : 'not mined'}`;
}

export function intruderFile(s: Pick<QdayState, 'log'>): { rows: IntruderRow[]; refused: number; succeeded: number } {
  const mined = [...s.log.onChain.rows, ...s.log.teamBot.rows].filter((r) => r.source !== 'team-setup');
  const rows: IntruderRow[] = [
    ...mined.filter((r) => r.failed).map((r): IntruderRow => ({ key: r.tx, when: r.time ?? null, height: r.height, bait: r.bait, call: r.call, who: SRC[r.source] ?? r.source, where: r.lane === 'hybrid' ? 'on chain (hybrid lane)' : 'on chain (EVM)', result: r.error ?? 'reverted', defence: defenceFor(r.call), tx: r.tx })),
    ...s.log.relayerRefused.rows.filter((r) => !/WOULD SUCCEED/.test(r.error)).map((r): IntruderRow => ({ key: `${r.at}-${r.bait}-${r.call}`, when: r.at, height: null, bait: r.bait, call: r.call, who: r.via === 'qday' ? 'a visitor (Try it)' : 'a relay request', where: 'refused before sending', result: r.error, defence: defenceFor(r.call), tx: null })),
  ];
  rows.sort((a, b) => (b.height ?? Infinity) - (a.height ?? Infinity) || String(b.when).localeCompare(String(a.when)));
  const succeeded = mined.filter((r) => !r.failed && r.call !== 'fund' && r.call !== 'deploy').length + s.log.relayerRefused.rows.filter((r) => /WOULD SUCCEED/.test(r.error)).length;
  return { rows, refused: rows.length, succeeded };
}
export interface QdayState {
  ok: true; label: string; network: string; keysPublished: boolean; baits: LiveBait[]; alarm: { raised: boolean; reasons: string[] };
  log: {
    onChain: { label: string; rows: AttemptRow[]; scanOk: boolean };
    relayerRefused: { label: string; rows: { at: string; bait: string; call: string; error: string; via: string }[] };
    teamBot: { label: string; runs: { id: number; status: string; conclusion: string | null; createdAt: string; url: string }[]; rows: AttemptRow[] };
  };
  generatedAt: string;
}
export async function fetchQday(): Promise<QdayState> {
  const r = await fetch(`${API_BASE}/api/qday`);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
  return j as QdayState;
}

export interface TryRow { id: string; path: string; outcome: 'refused' | 'WOULD SUCCEED'; detail: string; data?: Hex }
const ALL_ERRORS = [...errorsAbi, ...vaultAbi, ...routerAbi, ...dropAbi] as const;
export function revertName(e: unknown): string {
  const any = e as { walk?: (f: (x: unknown) => boolean) => unknown; shortMessage?: string; data?: Hex };
  const hit = any?.walk?.((q) => typeof (q as { data?: unknown })?.data === 'string') as { data?: Hex } | undefined;
  const d = hit?.data ?? any?.data;
  if (d) { try { return decodeErrorResult({ abi: ALL_ERRORS as never, data: d }).errorName; } catch { /* unknown selector */ } }
  return String(any?.shortMessage ?? 'reverted').slice(0, 80);
}
export const normKey = (k: string): Hex | null => { const v = k.trim().toLowerCase().replace(/^0x/, ''); return /^[0-9a-f]{64}$/.test(v) ? (`0x${v}` as Hex) : null; };

/** Every classical-key path against one Pocket, as eth_call. `atkSeed` is the attacker's own ML-DSA seed (random). */
export async function tryBait(baitId: string, classicalKey: Hex, atkSeed: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): Promise<TryRow[]> {
  const b = QDAY.baits.find((x) => x.id === baitId);
  if (!b) throw new Error('unknown bait');
  const acct = privateKeyToAccount(classicalKey);
  if (acct.address.toLowerCase() !== b.keyAccount.toLowerCase()) throw new Error(`This key controls ${acct.address}, not ${b.id}'s key account ${b.keyAccount}.`);
  const { mldsa } = await import('@qorechain/pqc');
  const atk = mldsa.keygen(atkSeed);
  const VP = b.pocket;
  const deployed = ((await pub.getCode({ address: VP })) ?? '0x') !== '0x';
  const nonce = deployed ? ((await pub.readContract({ address: VP, abi: vaultAbi, functionName: 'nonce' })) as bigint) : 0n;
  const dl = BigInt((await pub.getBlock()).timestamp) + 3600n;
  const signAtk = (action: Hex, p: Hex) => toHex(mldsa.sign(atk.secretKey, pqMessageBytes(intentDigest({ action, vault: VP, nonce, deadline: dl, params: p }))));
  const c = b.config;
  const via = (inner: Hex): Hex => deployed
    ? encodeFunctionData({ abi: routerAbi, functionName: 'relay', args: [VP, inner] })
    : encodeFunctionData({ abi: routerAbi, functionName: 'deployAndRelay', args: [c.owner, c.guardians, c.threshold, BigInt(c.dailyLimitWei), c.userSalt, inner] });
  const v = (fn: string, args: unknown[]) => encodeFunctionData({ abi: vaultAbi, functionName: fn, args } as never);
  const rows: TryRow[] = [];
  const call = async (id: string, path: string, data: Hex) => {
    try { await pub.call({ account: zeroAddress, to: QDAY.router, data }); rows.push({ id, path, outcome: 'WOULD SUCCEED', detail: 'no revert', data }); }
    catch (e) { rows.push({ id, path, outcome: 'refused', detail: revertName(e), data }); }
  };
  const amt = parseEther('0.01');
  await call('E1', 'Spend to the attacker, signed with the attacker\'s own ML-DSA key', via(v('spend', [SINK, amt, dl, signAtk(ACT.SPEND, params.spend(SINK, amt))])));
  const digest = intentDigest({ action: ACT.SPEND, vault: VP, nonce, deadline: dl, params: params.spend(SINK, amt) });
  await call('E2', 'Spend signed with the stolen classical (ECDSA) key', via(v('spend', [SINK, amt, dl, await acct.sign({ hash: digest })])));
  const g: Hex[] = [SINK, '0x000000000000000000000000000000000000bEEF'];
  await call('E3', 'Replace the guardians with attacker addresses', via(v('setGuardians', [g, 2, dl, signAtk(ACT.SET_GUARDIANS, params.guardians(g, 2))])));
  await call('E4', 'Raise the daily limit to 100 QOR', via(v('setLimit', [parseEther('100'), dl, signAtk(ACT.SET_LIMIT, params.limit(parseEther('100')))])));
  await call('E5', 'Cancel the owner\'s pending changes', via(v('cancelPending', [dl, signAtk(ACT.CANCEL_PENDING, '0x')])));
  if (deployed && c.guardians.length) {
    const kh = keccak256(toHex(atk.publicKey));
    const sig = toHex(mldsa.sign(atk.secretKey, pqMessageBytes(keccak256('0x00'))));
    await call('E7', 'Recover the Pocket to the attacker with forged guardian signatures', via(v('proposeRecovery', [SINK, kh, dl, c.guardians, c.guardians.map(() => sig)])));
  }
  if (deployed) await call('E8', 'Veto the owner\'s queued spend', via(v('vetoQueued', [1n, dl, signAtk(ACT.VETO_QUEUED, params.id(1n))])));
  if (b.planned?.drop) {
    const id = BigInt(b.planned.drop.linkId);
    const cd = (await pub.readContract({ address: QDAY.drop, abi: dropAbi, functionName: 'claimDigest', args: [id, b.keyAccount, VP] })) as Hex;
    await call('E9', `Claim drop p${id} (bound to this account) with the attacker's ML-DSA key`, encodeFunctionData({ abi: routerAbi, functionName: 'relay', args: [QDAY.drop, encodeFunctionData({ abi: dropAbi, functionName: 'claim', args: [id, toHex(mldsa.sign(atk.secretKey, pqMessageBytes(cd)))] })] }));
  }
  if (deployed) {
    const h = keccak256(toHex('qday'));
    const r = await pub.readContract({ address: VP, abi: vaultAbi, functionName: 'isValidSignature', args: [h, await acct.sign({ hash: h })] }).catch(() => '0xffffffff');
    rows.push({ id: 'E10', path: 'ERC-1271: is an ECDSA signature valid for this Pocket?', outcome: r === '0x1626ba7e' ? 'WOULD SUCCEED' : 'refused', detail: String(r) });
  }
  return rows;
}

/** Ask our relayer to mine one attempt (it simulates first and refuses to mine anything that would succeed). */
export async function putOnChain(data: Hex): Promise<{ ok: boolean; txHash?: string; explorer?: string; status?: string; expectedRevert?: string; error?: { message: string } }> {
  const r = await fetch(`${API_BASE}/api/qday`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: QDAY.router, data }) });
  return r.json();
}

export const attackScript = (baitId: string) => `# Diana TESTNET only. Needs Node 20+ only (ABIs are committed; no Foundry).
git clone https://github.com/mohamedwael201193/pocket-drop && cd pocket-drop/contracts-v4
npm ci
# every classical-key path, read-only (CometBFT check_tx + eth_call); the key comes from /api/qday
node script/qday/attack.mjs --bait ${baitId}
# put one Pocket attempt on chain through our relayer (rate-limited; it only mines calls that revert)
node script/qday/attack.mjs --bait ${baitId} --mine ${baitId}:E1`;
