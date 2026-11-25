// (e) Guardian unanimous recovery of a LAB Pocket on the DEPLOYED URL: all 3 guardians sign, the Pocket moves to a NEW key after the
// (lab) 180 s delay, and the new key sweeps the funds. Needs E2E_RECOVER_POCKET (the LAB Pocket whose guardians are the E2E guardians).
//   E2E_RECOVER_POCKET=0x... E2E_URL=https://pocket-drop.vercel.app npx playwright test e2e/recover.spec.ts --project=chromium-390
import { test, expect, type Browser, type Page } from '@playwright/test';
import { readRoot } from './vault';
import fs from 'node:fs';
import path from 'node:path';
import type { Hex } from 'viem';
import { balanceOf, deployerAddress, fund, guardians, keyProven, qor, recovered, txOk, vaultRead } from './chain4';

const URL = (process.env.E2E_URL ?? 'https://pocket-drop.vercel.app').replace(/\/$/, '');
const POCKET = process.env.E2E_RECOVER_POCKET as Hex | undefined;
const EVID = path.resolve('evidence/v4/e2e');
const T = 240_000;
const micro = (wei: bigint) => { const m = wei / 10n ** 12n; return `${m / 1_000_000n}.${(m % 1_000_000n).toString().padStart(6, '0')}`; };

test.skip(!POCKET, 'set E2E_RECOVER_POCKET');
test.setTimeout(1_500_000);

test('e. Unanimous guardian recovery to a new key, then the new key moves the funds', async ({ browser }, info) => {
  const opts = (info.project.use as Record<string, unknown>) ?? {};
  const txs: Record<string, string> = {};
  const G = await guardians(3);
  const N = await (browser as Browser).newContext(opts);
  const np = await N.newPage();
  const open: { close: () => Promise<void> }[] = [N];
  try {
    // the new key: created in a fresh browser, funded for its registration, registered
    await np.goto(`${URL}/pocket?env=lab`);
    const keep = process.env.E2E_NEW_OWNER_FILE ?? 'D:/route/QORE/.secrets/pd-e2e-new-owner.json';
    const prev = fs.existsSync(keep) ? (JSON.parse(fs.readFileSync(keep, 'utf8')) as { root?: string; evm?: Hex; pocket?: string }) : null;
    let keyAddr: Hex;
    if (prev?.root && prev.evm && prev.pocket?.toLowerCase() === POCKET!.toLowerCase() && (await keyProven(prev.evm))) {
      // a previous run already created and registered this new key (and saved it outside the repo): reuse it instead of paying again
      await np.getByText('Restore from a backup key').click();
      await np.getByTestId('restore-input').fill(prev.root);
      await np.getByTestId('restore-key').click();
      keyAddr = prev.evm;
    } else {
      await np.getByTestId('create-key').click();
      keyAddr = (await np.getByTestId('key-address').getAttribute('data-address', { timeout: T }))! as Hex;
      txs['fund new key account 0.075 QOR'] = await fund(keyAddr, 0.075, 'e2e recovery new key');
      await expect.poll(async () => BigInt((await np.getByTestId('key-balance').getAttribute('data-wei')) || '0'), { timeout: T }).toBeGreaterThanOrEqual(70_000_000_000_000_000n);
      await np.getByTestId('register-key').click();
      await expect(np.getByTestId('key-ready')).toBeVisible({ timeout: T });
    }
    const newCode = (await np.getByTestId('new-owner-code').textContent())!;
    // keep the new key outside the repo, so a failed run can never strand the recovered funds
    const root = await readRoot(np);
    fs.writeFileSync(keep, JSON.stringify({ root, evm: keyAddr, pocket: POCKET }, null, 1));

    // each guardian signs the same unanimous-recovery request on their own device
    const signAs = async (g: { root: string }, reqCode?: string) => {
      const c = await (browser as Browser).newContext(opts); open.push(c);
      const p: Page = await c.newPage();
      await p.goto(`${URL}/pocket?env=lab`);
      await p.getByText('Restore from a backup key').click();
      await p.getByTestId('restore-input').fill(g.root);
      await p.getByTestId('restore-key').click();
      await expect(p.getByTestId('help-friend')).toBeVisible({ timeout: T });
      let code = reqCode;
      if (!code) {
        await p.getByTestId('req-kind').selectOption('recover-unanimous');
        await p.getByTestId('req-pocket').fill(POCKET!);
        await p.getByTestId('req-newcode').fill(newCode);
        await p.getByTestId('req-make').click();
        await expect(p.getByTestId('req-code')).toBeVisible({ timeout: 60_000 });
        code = (await p.getByTestId('req-code').textContent())!;
      }
      await p.getByTestId('sign-input').fill(code);
      await expect(p.getByTestId('sign-info')).toBeVisible({ timeout: 60_000 });
      await expect(p.getByTestId('not-guardian')).toHaveCount(0);
      await p.getByTestId('sign-button').click();
      await expect(p.getByTestId('share-code')).toBeVisible({ timeout: 60_000 });
      return { p, code: code!, share: (await p.getByTestId('share-code').textContent())! };
    };
    const s1 = await signAs(G[0]);
    const s2 = await signAs(G[1], s1.code);
    const s3 = await signAs(G[2], s1.code);
    await s1.p.getByTestId('shares-input').fill([s1.share, s2.share, s3.share].join('\n'));
    await s1.p.getByTestId('shares-submit').click();
    await expect(s1.p.getByTestId('shares-tx')).toBeVisible({ timeout: T });
    txs['3 of 3 guardians propose a unanimous recovery to the new key'] = (await s1.p.getByTestId('shares-tx').getAttribute('data-hash'))!;
    expect(await vaultRead<bigint>(POCKET!, 'uRecoveryAt')).toBeGreaterThan(0n);

    // the new key takes the Pocket over in its app, sees "cannot be vetoed", waits out the delay and finishes the recovery
    await np.getByTestId('adopt-input').fill(POCKET!);
    await np.getByTestId('adopt-button').click();
    await expect(np.getByTestId('pending-unanimous')).toContainText('cannot be vetoed', { timeout: T });
    await expect(np.getByTestId('finalize-unanimous')).toBeEnabled({ timeout: 400_000 });
    await np.getByTestId('finalize-unanimous').click();
    await expect.poll(async () => (await vaultRead<Hex>(POCKET!, 'owner')).toLowerCase(), { timeout: 120_000 }).toBe(keyAddr.toLowerCase());
    await expect(np.getByTestId('recovery-section')).toBeVisible();

    // the new key sweeps the funds back to the deployer through the app
    await np.reload();
    const bal = await balanceOf(POCKET!);
    await expect(np.getByTestId('spend-to')).toBeVisible({ timeout: T });
    await np.getByTestId('spend-to').fill(await deployerAddress());
    const amount = bal - (bal % 10n ** 12n);
    await np.getByTestId('spend-amount').fill(micro(amount));
    await expect(np.getByTestId('spend-send')).toBeEnabled({ timeout: 60_000 });
    await np.getByTestId('spend-send').click();
    await expect(np.getByTestId('spend-tx')).toBeVisible({ timeout: T });
    const sweep = (await np.getByTestId('spend-tx').getAttribute('data-hash'))!;
    txs['new owner sweeps the recovered Pocket back to the deployer'] = sweep;
    for (const h of Object.values(txs)) expect(await txOk(h)).toBe(true);
    await recovered(qor(amount), 'recovery sweep', sweep);
    fs.writeFileSync(path.join(EVID, `${info.project.name}-e-recovery.json`), JSON.stringify({ project: info.project.name, flow: 'e-recovery', pocket: POCKET, newOwner: keyAddr, txs, finishedAt: new Date().toISOString() }, null, 1));
  } finally { for (const c of open) await c.close(); }
});
