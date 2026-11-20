import { useState } from 'react';
import { isAddress, type Hex } from 'viem';
import { Button, CopyButton, Mono, Notice, TxLink } from './ui';
import { useAccount, useKeyAccount } from '../lib/account';
import { decodeCode, encodeCode, makeRequest, newOwnerCode, requestDigest, signRequest, submitShares, type GuardianKind, type GuardianRequest, type GuardianShare } from '../lib/actions';
import { INST, readPocket, type Env } from '../lib/v4';
import { explainError } from '../lib/api';

// "threshold" = the minimum number of guardians the owner chose (for example 2 of 3); "unanimous" = every guardian (UX-6)
const KINDS: { v: GuardianKind; label: string; help: string }[] = [
  { v: 'freeze', label: 'Freeze the Pocket (enough guardians sign)', help: 'Stops spending, drops and limit raises for the freeze period. Use it when the owner key may be stolen. "Enough" is the number the owner chose, for example 2 of 3 guardians.' },
  { v: 'recover', label: 'Move the Pocket to a new key (enough guardians sign)', help: 'Replaces the owner key after a delay. The old key can still say no (veto) during the delay, so a lost phone gets recovered but a few guardians cannot take a Pocket from an owner who still has their key.' },
  { v: 'recover-unanimous', label: 'Move the Pocket to a new key (every guardian signs)', help: 'Needs every single guardian. After its delay it replaces the key and the old key CANNOT stop it, so it works even when a thief holds the old key.' },
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
  const reqReady = isAddress(pocket) && (kind === 'freeze' || newCode.trim() !== '');
  const shareCount = (sharesIn.match(/pdshare1\.[A-Za-z0-9_-]+/g) ?? []).length;

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
        <label htmlFor="req-kind" className="block text-xs font-medium text-zinc-700">What should the guardians do?</label>
        <select id="req-kind" value={kind} onChange={(e) => { setKind(e.target.value as GuardianKind); setReqErr(null); }} data-testid="req-kind" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm">{KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</select>
        <p className="text-xs text-zinc-600">{KINDS.find((k) => k.v === kind)!.help}</p>
        <label htmlFor="req-pocket" className="block text-xs font-medium text-zinc-700">Friend&apos;s Pocket address</label>
        <input id="req-pocket" value={pocket} onChange={(e) => { setPocket(e.target.value.trim()); setReqErr(null); }} placeholder="0x…" aria-invalid={pocket !== '' && !isAddress(pocket)} data-testid="req-pocket" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />
        {pocket !== '' && !isAddress(pocket) && <p role="alert" className="text-xs font-medium text-red-700" data-testid="req-pocket-error">A Pocket address is 0x followed by 40 characters.</p>}
        {kind !== 'freeze' && <label htmlFor="req-newcode" className="block text-xs font-medium text-zinc-700">Friend&apos;s new-key code (from their &quot;I lost my phone&quot; section)</label>}
        {kind !== 'freeze' && <textarea id="req-newcode" value={newCode} onChange={(e) => { setNewCode(e.target.value); setReqErr(null); }} rows={2} placeholder="pdnew1.…" data-testid="req-newcode" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />}
        <Button onClick={() => void makeReq()} disabled={!reqReady} data-testid="req-make">Create request code</Button>
        {!reqReady && <p className="text-xs text-zinc-600" data-testid="req-reason">{!isAddress(pocket) ? 'Enter the friend\'s Pocket address first.' : 'Paste the friend\'s new-key code first.'}</p>}
        {reqErr && <Notice tone="error" testId="req-error">{reqErr}</Notice>}
        {reqCode && <div className="space-y-2"><Mono className="block max-h-24 overflow-auto rounded-xl border border-zinc-200 bg-white p-2" ><span data-testid="req-code">{reqCode}</span></Mono><CopyButton text={reqCode} label="Copy request" testId="copy-req" /><p className="text-xs text-zinc-500">Send this to each guardian. It expires in one hour.</p></div>}
      </div>

      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white/70 p-4">
        <h3 className="text-sm font-semibold text-zinc-900">2. Sign a request (each guardian, on their own device)</h3>
        <label htmlFor="sign-input" className="block text-xs font-medium text-zinc-700">Request code you received</label>
        <textarea id="sign-input" value={signIn} onChange={(e) => void checkRequest(e.target.value)} rows={2} placeholder="pdreq1.…" data-testid="sign-input" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />
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
        {(!signInfo || !a.acct) && <p className="text-xs text-zinc-600" data-testid="sign-reason">{!a.acct ? 'Open or restore your key first (Pocket and key, above).' : 'Paste a request code first.'}</p>}
        {signErr && <Notice tone="error" testId="sign-error">{signErr}</Notice>}
        {signed && <div className="space-y-2"><Mono className="block max-h-24 overflow-auto rounded-xl border border-zinc-200 bg-white p-2"><span data-testid="share-code">{signed}</span></Mono><CopyButton text={signed} label="Copy my signature share" testId="copy-share" /></div>}
      </div>

      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white/70 p-4">
        <h3 className="text-sm font-semibold text-zinc-900">3. Submit the signatures</h3>
        <label htmlFor="shares-input" className="block text-xs font-medium text-zinc-700">Every guardian&apos;s signature share, one after another</label>
        <textarea id="shares-input" value={sharesIn} onChange={(e) => { setSharesIn(e.target.value); setSub({}); }} rows={4} placeholder="pdshare1.…" data-testid="shares-input" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" />
        <Button busy={sub.busy} disabled={shareCount === 0} onClick={() => void submit()} data-testid="shares-submit">Submit to the chain{shareCount > 0 ? ` (${shareCount} signature${shareCount > 1 ? 's' : ''})` : ''}</Button>
        {shareCount === 0 && <p className="text-xs text-zinc-600" data-testid="shares-reason">Paste at least one signature share first.</p>}
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
      const me = a.acct!.evm.toLowerCase();
      const pending = pv.unanimous?.newOwner.toLowerCase() === me || pv.recovery?.newOwner.toLowerCase() === me;
      const owner = pv.owner?.toLowerCase() === me;
      if (!owner && !pending) throw new Error('This browser\'s key is not the owner of that Pocket, and no recovery to it is pending. Ask your guardians to start the recovery with your new-key code.');
      a.adopt(adoptText as Hex);
      setMsg({ tone: 'ok', text: owner ? 'This Pocket is now yours here. Switch to it in the Pocket and key card.' : 'A recovery to your key is pending. The Pocket is shown in the Pocket and key card; finish the recovery there once its delay is over.' });
    } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); }
  }
  const code = newOwnerCode(a.acct);
  return (
    <div className="space-y-4" data-testid="lost-phone">
      <p className="text-sm leading-relaxed text-zinc-700">Lost your phone? On a new device, create a new key, register it (above), then give your guardians this code. They start a recovery to it; after the delay you can take your Pocket over.</p>
      <div className="rounded-2xl border border-zinc-200 bg-white/70 p-3"><Mono className="block max-h-20 overflow-auto"><span data-testid="new-owner-code">{code}</span></Mono><div className="mt-2"><CopyButton text={code} label="Copy my new-key code" testId="copy-newcode" /></div></div>
      <div className="space-y-2"><label className="text-sm font-semibold text-zinc-900" htmlFor="adopt">Take over the Pocket (once guardians have started the recovery to your key)</label>
        <div className="flex gap-2"><input id="adopt" value={adoptText} onChange={(e) => { setAdoptText(e.target.value.trim()); setMsg(null); }} placeholder="Old Pocket address 0x…" data-testid="adopt-input" className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs" /><Button variant="secondary" onClick={() => void adopt()} data-testid="adopt-button">Check and take over</Button></div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}</div>
    </div>
  );
}
