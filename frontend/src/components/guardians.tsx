import { useState } from 'react';
import { isAddress, type Hex } from 'viem';
import { Button, CopyButton, Mono, Notice, TxLink } from './ui';
import { useAccount, useKeyAccount } from '../lib/account';
import { decodeCode, encodeCode, makeRequest, newOwnerCode, requestDigest, signRequest, submitShares, type GuardianKind, type GuardianRequest, type GuardianShare } from '../lib/actions';
import { INST, readPocket, type Env } from '../lib/v4';
import { explainError } from '../lib/api';

const KINDS: { v: GuardianKind; label: string; help: string }[] = [
  { v: 'freeze', label: 'Freeze (threshold of guardians)', help: 'Stops spending, drops and limit raises for the freeze period. Use it when the owner key may be stolen.' },
  { v: 'recover', label: 'Recovery to a new key (threshold)', help: 'Replaces the owner key after a delay. The old owner key can veto it, so a lost phone is recovered but a stolen key cannot be cheated by a few guardians.' },
  { v: 'recover-unanimous', label: 'Recovery to a new key (all guardians)', help: 'Needs every guardian. After its delay it replaces the key and CANNOT be vetoed, so it works even when a thief holds the old key.' },
];

/** The guardian flow: one person makes a request, each guardian signs it on their own device, anyone submits the collected shares. */
export function HelpFriend() {
  const a = useAccount();
  const key = useKeyAccount();
  const [kind, setKind] = useState<GuardianKind>('freeze');
  const [pocket, setPocket] = useState('');
  const [newCode, setNewCode] = useState('');
  const [reqCode, setReqCode] = useState<string | null>(null);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [signIn, setSignIn] = useState('');
  const [signed, setSigned] = useState<string | null>(null);
  const [signErr, setSignErr] = useState<string | null>(null);
  const [signInfo, setSignInfo] = useState<{ r: GuardianRequest; guardians: Hex[] } | null>(null);
  const [sharesIn, setSharesIn] = useState('');
  const [sub, setSub] = useState<{ hash?: string; err?: string; busy?: boolean }>({});
  const env: Env = a.env;

  async function makeReq() {
    setReqErr(null); setReqCode(null);
    try {
      if (!isAddress(pocket)) throw new Error('Enter the friend\'s Pocket address (0x…).');
      let newOwner: Hex | undefined; let newKeyHash: Hex | undefined;
      if (kind !== 'freeze') {
        const n = decodeCode<{ owner: Hex; keyHash: Hex }>('pdnew1', newCode);
        if (!isAddress(n.owner) || !/^0x[0-9a-fA-F]{64}$/.test(n.keyHash)) throw new Error('That new-key code is not valid.');
        newOwner = n.owner; newKeyHash = n.keyHash;
      }
      const pv = await readPocket(env, pocket as Hex);
      if (!pv.deployed) throw new Error('That Pocket is not deployed on this instance (check the Production / Lab switch above).');
      if (pv.guardians.length === 0) throw new Error('That Pocket has no guardians.');
      setReqCode(encodeCode('pdreq1', await makeRequest({ kind, env, pocket: pocket as Hex, newOwner, newKeyHash })));
    } catch (e) { setReqErr(explainError(e)); }
  }

  async function checkRequest(text: string) {
    setSignIn(text); setSigned(null); setSignErr(null); setSignInfo(null);
    if (!text.trim()) return;
    try {
      const r = decodeCode<GuardianRequest>('pdreq1', text);
      const pv = await readPocket(r.env, r.pocket);
      setSignInfo({ r, guardians: pv.guardians });
    } catch (e) { setSignErr((e as Error).message); }
  }
  async function sign() {
    if (!signInfo || !a.acct) return;
    setSignErr(null);
    try { requestDigest(signInfo.r); const share = await signRequest(signInfo.r, a.acct); setSigned(encodeCode('pdshare1', share)); }
    catch (e) { setSignErr(explainError(e)); }
  }

  async function submit() {
    setSub({ busy: true });
    try {
      const codes = sharesIn.match(/pdshare1\.[A-Za-z0-9_-]+/g) ?? [];
      const shares = codes.map((c) => decodeCode<GuardianShare>('pdshare1', c));
      const r = await submitShares(shares);
      setSub({ hash: r.txHash });
    } catch (e) { setSub({ err: explainError(e) }); }
  }

  return (
    <div className="space-y-6" data-testid="help-friend">
      <p className="text-sm leading-relaxed text-zinc-700">You are a guardian, or you were asked to start a rescue. Nothing here needs the friend&apos;s key: each guardian signs a request with their own key on their own device, then anyone submits the signatures. Guardians must have registered their own quantum-safe key.</p>

      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white/70 p-4">
        <h3 className="text-sm font-semibold text-zinc-900">1. Start a request</h3>
        <select value={kind} onChange={(e) => setKind(e.target.value as GuardianKind)} data-testid="req-kind" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm">{KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</select>
        <p className="text-xs text-zinc-600">{KINDS.find((k) => k.v === kind)!.help}</p>
        <input value={pocket} onChange={(e) => setPocket(e.target.value.trim())} placeholder="Friend's Pocket address 0x…" data-testid="req-pocket" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />
        {kind !== 'freeze' && <textarea value={newCode} onChange={(e) => setNewCode(e.target.value)} rows={2} placeholder="The friend's new-key code (pdnew1.…), from their I lost my phone section" data-testid="req-newcode" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />}
        <Button onClick={() => void makeReq()} data-testid="req-make">Create request code</Button>
        {reqErr && <Notice tone="error" testId="req-error">{reqErr}</Notice>}
        {reqCode && <div className="space-y-2"><Mono className="block max-h-24 overflow-auto rounded-xl border border-zinc-200 bg-white p-2" ><span data-testid="req-code">{reqCode}</span></Mono><CopyButton text={reqCode} label="Copy request" testId="copy-req" /><p className="text-xs text-zinc-500">Send this to each guardian. It expires in one hour.</p></div>}
      </div>

      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white/70 p-4">
        <h3 className="text-sm font-semibold text-zinc-900">2. Sign a request (each guardian, on their own device)</h3>
        <textarea value={signIn} onChange={(e) => void checkRequest(e.target.value)} rows={2} placeholder="Paste the request code (pdreq1.…)" data-testid="sign-input" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />
        {signInfo && (
          <div className="space-y-1 text-xs text-zinc-700" data-testid="sign-info">
            <div>Action: <b>{signInfo.r.kind}</b> on Pocket <Mono>{signInfo.r.pocket}</Mono> ({signInfo.r.env})</div>
            {signInfo.r.newOwner && <div>New owner: <Mono>{signInfo.r.newOwner}</Mono></div>}
            {!a.acct ? <Notice tone="warn">Open or restore your key first (Pocket and key, above).</Notice>
              : !signInfo.guardians.some((g) => g.toLowerCase() === a.acct!.evm.toLowerCase()) ? <Notice tone="warn" testId="not-guardian">This browser&apos;s key <Mono>{a.acct.evm}</Mono> is not a guardian of that Pocket.</Notice>
              : !key.ready ? <Notice tone="warn">Register your quantum-safe key first (above), or the chain will refuse your signature.</Notice> : null}
          </div>
        )}
        <Button variant="secondary" disabled={!signInfo || !a.acct} onClick={() => void sign()} data-testid="sign-button">Sign with my key</Button>
        {signErr && <Notice tone="error" testId="sign-error">{signErr}</Notice>}
        {signed && <div className="space-y-2"><Mono className="block max-h-24 overflow-auto rounded-xl border border-zinc-200 bg-white p-2"><span data-testid="share-code">{signed}</span></Mono><CopyButton text={signed} label="Copy my signature share" testId="copy-share" /></div>}
      </div>

      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white/70 p-4">
        <h3 className="text-sm font-semibold text-zinc-900">3. Submit the signatures</h3>
        <textarea value={sharesIn} onChange={(e) => setSharesIn(e.target.value)} rows={4} placeholder="Paste every guardian's signature share (pdshare1.…), one after another" data-testid="shares-input" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />
        <Button busy={sub.busy} onClick={() => void submit()} data-testid="shares-submit">Submit to the chain</Button>
        {sub.err && <Notice tone="error" testId="shares-error">{sub.err}</Notice>}
        {sub.hash && <Notice tone="ok" testId="shares-ok">Mined: <TxLink hash={sub.hash} testId="shares-tx" /></Notice>}
        <p className="text-xs text-zinc-500">The chain checks each signature against the guardian&apos;s registered key. Instance: {env === 'prod' ? 'production' : 'lab'} ({INST[env].router.slice(0, 8)}…).</p>
      </div>
    </div>
  );
}

/** The friend side: the new-key code to hand to guardians, and taking over the recovered Pocket. */
export function LostPhone() {
  const a = useAccount();
  const [adoptText, setAdoptText] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  if (!a.acct) return null;
  async function adopt() {
    setMsg(null);
    try {
      if (!isAddress(adoptText)) throw new Error('Enter the Pocket address (0x…).');
      const pv = await readPocket(a.env, adoptText as Hex);
      if (!pv.deployed) throw new Error('That Pocket is not deployed on this instance.');
      if (pv.owner?.toLowerCase() !== a.acct!.evm.toLowerCase()) throw new Error('This browser\'s key is not the owner of that Pocket (yet). Has the recovery been finished?');
      a.adopt(adoptText as Hex); setMsg({ tone: 'ok', text: 'This Pocket is now yours here. Switch to it in the Pocket and key card.' });
    } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); }
  }
  const code = newOwnerCode(a.acct);
  return (
    <div className="space-y-4" data-testid="lost-phone">
      <p className="text-sm leading-relaxed text-zinc-700">Lost your phone? On a new device, create a new key, register it (above), then give your guardians this code. They start a recovery to it; after the delay you can take your Pocket over.</p>
      <div className="rounded-2xl border border-zinc-200 bg-white/70 p-3"><Mono className="block max-h-20 overflow-auto"><span data-testid="new-owner-code">{code}</span></Mono><div className="mt-2"><CopyButton text={code} label="Copy my new-key code" testId="copy-newcode" /></div></div>
      <div className="space-y-2"><label className="text-sm font-semibold text-zinc-900" htmlFor="adopt">After the recovery is finished: take over the Pocket</label>
        <div className="flex gap-2"><input id="adopt" value={adoptText} onChange={(e) => setAdoptText(e.target.value.trim())} placeholder="Old Pocket address 0x…" data-testid="adopt-input" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" /><Button variant="secondary" onClick={() => void adopt()} data-testid="adopt-button">Check and take over</Button></div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}</div>
    </div>
  );
}
