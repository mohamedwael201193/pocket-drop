import { useState } from 'react';
import { isAddress, type Hex } from 'viem';
import { bech32 } from '@scure/base';
import { Button, CopyButton, Mono, Notice, SourceBadge, TxLink } from './ui';
import { useAccount } from '../lib/account';
import { keyStatus, type KeyStatus } from '../lib/claim4';
import { fundFromQorex } from '../lib/qorex';
import { cosmosAddressOf, fmtQor, parseQor, pub } from '../lib/chain';
import { explainError } from '../lib/api';

/** Accepts 0x… or qor1… and returns the 0x address. */
export function toEvmAddress(raw: string): Hex | null {
  const t = raw.trim();
  if (isAddress(t)) return t as Hex;
  try {
    const d = bech32.decode(t as `${string}1${string}`);
    if (d.prefix !== 'qor') return null;
    const b = bech32.fromWords(d.words);
    return b.length === 20 ? (`0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}` as Hex) : null;
  } catch { return null; }
}

/** Q-Day Rescue: find legacy accounts whose key never proved possession (so PQ cannot protect them) and move the funds into the Pocket. */
export function RescuePanel() {
  const a = useAccount();
  const [input, setInput] = useState(a.identity?.evm ?? '');
  const [res, setRes] = useState<{ addr: Hex; ks: KeyStatus; bal: bigint } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amt, setAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function check() {
    setErr(null); setRes(null); setSent(null);
    const addr = toEvmAddress(input);
    if (!addr) { setErr('Enter a 0x… or qor1… address.'); return; }
    try {
      const [ks, bal] = await Promise.all([keyStatus(addr), pub.getBalance({ address: addr })]);
      setRes({ addr, ks, bal });
    } catch (e) { setErr(explainError(e)); }
  }
  const pocket = a.activePocket;
  const qorexOwns = !!res && !!a.identity && (a.identity.evm?.toLowerCase() === res.addr.toLowerCase() || cosmosAddressOf(res.addr) === a.identity.cosmos);
  async function send() {
    if (!a.identity || !pocket) return;
    const v = parseQor(amt);
    if (v === null || v === 0n) { setErr('Enter an amount like 1.5.'); return; }
    setBusy(true); setErr(null);
    try { setSent((await fundFromQorex(a.identity, cosmosAddressOf(pocket), v / 10n ** 12n)).txHash); }
    catch (e) { setErr(explainError(e)); } finally { setBusy(false); }
  }
  const unproven = !!res && !res.ks.possessionProven;

  return (
    <div className="space-y-4" data-testid="rescue">
      <p className="text-sm leading-relaxed text-zinc-700">An account whose key never proved possession of a quantum-safe key cannot be protected by a post-quantum check: a future quantum computer could forge its classical signature. Paste an address to see whether it is one, then move its funds into Your Pocket, which only an ML-DSA key can move.</p>
      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x… or qor1… address" aria-label="Address to check" data-testid="rescue-input" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono text-xs" />
        <Button variant="secondary" onClick={() => void check()} data-testid="rescue-check">Check</Button>
      </div>
      {err && <Notice tone="error" testId="rescue-error">{err}</Notice>}
      {res && (
        <div className="space-y-3" data-testid="rescue-result" data-proven={res.ks.possessionProven ? '1' : '0'}>
          <div className="flex items-center gap-2 text-xs text-zinc-600"><SourceBadge kind="LIVE" />pqcKeyStatus: registered={String(res.ks.registered)}, possessionProven={String(res.ks.possessionProven)} · balance {fmtQor(res.bal)} QOR</div>
          {unproven ? (
            <Notice tone="warn" testId="rescue-unproven">PQ cannot be enforced on this account (<b>possessionProven = false</b>{res.ks.registered ? '' : ', no quantum-safe key registered'}). Move its QOR into Your Pocket.</Notice>
          ) : <Notice tone="ok" testId="rescue-proven">This account already has a registered, proven ML-DSA key. It is protected where it is; moving it into a Pocket is optional.</Notice>}
          {unproven && pocket && (
            <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white/70 p-4">
              {qorexOwns && a.identity?.canFund ? (
                <div className="space-y-2" data-testid="rescue-oneclick">
                  <p className="text-sm font-medium text-zinc-900">One tap with QoreX</p>
                  <div className="flex gap-2"><input value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={`up to ${fmtQor(res.bal)} QOR`} inputMode="decimal" aria-label="Amount" className="w-40 rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm" /><Button busy={busy} onClick={() => void send()} data-testid="rescue-send">Send into my Pocket</Button></div>
                  {sent && <Notice tone="ok">Sent: <TxLink hash={sent} testId="rescue-tx" /></Notice>}
                </div>
              ) : (
                <p className="text-xs text-zinc-500" data-testid="rescue-oneclick-hidden">One-tap QoreX send is hidden: {a.identity ? 'the connected QoreX account is not this address, or this QoreX build cannot send from a web page.' : 'QoreX is not connected (and QoreX runs on mainnet today; this app is on Diana testnet).'} Use the exact steps below.</p>
              )}
              <div className="space-y-2" data-testid="rescue-manual">
                <p className="text-sm font-medium text-zinc-900">Exact steps</p>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                  <li>Open the wallet that holds the account you checked.</li>
                  <li>Make a normal native QOR send (a plain transfer, not a contract call) of everything except about 0.1 QOR for the network fee.</li>
                  <li>Send it to Your Pocket address below, in either form. It works before the Pocket exists on-chain.</li>
                  <li>Come back: the balance in Your Pocket updates by itself.</li>
                </ol>
                <div className="text-xs text-zinc-500">0x form</div><Mono className="block">{pocket}</Mono><CopyButton text={pocket} label="Copy 0x address" testId="rescue-copy-evm" />
                <div className="text-xs text-zinc-500">qor1 form (for Cosmos-style wallets)</div><Mono className="block">{cosmosAddressOf(pocket)}</Mono><CopyButton text={cosmosAddressOf(pocket)} label="Copy qor1 address" testId="rescue-copy-bech" />
              </div>
            </div>
          )}
          {unproven && !pocket && <Notice tone="info">Create your Pocket first (Pocket and key, above) so there is an address to send into.</Notice>}
        </div>
      )}
    </div>
  );
}
