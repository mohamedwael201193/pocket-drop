# Known issues and honest limits (Pocket Drop v4, Diana testnet)

Written before QCAI Stage 1. After Stage 1 edits are allowed only for findings.

## 1. Testnet only
- Everything is deployed on QoreChain Diana (EVM 9800). The `pqcVerify` / `pqcKeyStatus` precompiles are not live on mainnet; no mainnet claim is made anywhere. The QOR here has no value.
- The contracts are unaudited. No owner/admin/upgrade path exists in the contracts, which also means a bug cannot be patched in place (redeploy).

## 2. The relayer
- One relayer key submits all intents through `PocketRouter`. Its EVM window is scoped to `[PocketRouter prod, PocketRouter lab, PocketDrop v3]`, so the chain refuses any other target at broadcast (shown in `LIVE_RESULTS.md`).
- The relayer holds no user secret. It can censor (not submit), delay, or reorder intents; it cannot forge one, and an unsubmitted intent stays valid until its deadline. A relayer outage stops new actions; funds stay put and Pockets stay recoverable by guardians (the guardians need a submitter too: anyone can call the router).
- The relayer window must be renewed (17,280 blocks max, ~6.9 h). The GitHub Actions renewer (`.github/workflows/renew-window.yml`) does it; its key (a GitHub secret) can only open windows for the listed targets and move the relayer's own gas money.
- The relayer collects `relayerFee` from the first bind. That is its only income and it is capped by the sender at link creation.
- Front-running: anyone may submit someone else's signed intent or bind. That is safe by design (the submitter gains nothing: payout addresses and amounts are signed), but it means the intended submitter's tx can fail with a nonce/state error if somebody else was first.

## 3. Guardian trust (revised before QCAI Stage 1: guardian freeze + unanimous recovery)
The first design had one recovery path (`threshold` guardians, vetoable by the CURRENT owner key). That defends against colluding guardians but loses the case recovery exists for: with a STOLEN key the thief vetoes forever and the guardians cannot override. It is replaced by three tools:
- `guardianFreeze` (`threshold` guardian ML-DSA signatures): blocks `spend`, `executeQueued`, `createDrop`/`createPool`, `applyLimit`/`applyGuardians` and any new queueing (limit raise, guardian change) for `FREEZE_PERIOD` (prod 72 h, lab 120 s). The owner key cannot lift it; it expires by itself. Defensive owner actions still work (veto a queued spend, lower the limit, `cancelPending`, `vetoRecovery`, confirm/cancel a drop, close a pool).
- `proposeRecoveryUnanimous` (ALL configured guardians, set >= 2): `UNANIMOUS_RECOVERY_DELAY` (prod 72 h, lab 180 s), the old key CANNOT veto it, it overrides a pending threshold recovery, and while it is pending the Pocket counts as frozen (so the freeze cannot lapse before the recovery lands). A finalized recovery of either kind bumps `epoch` and kills every queued spend and pending limit/guardian change.
- The threshold recovery (`proposeRecovery`, 48 h prod, owner veto) is unchanged. It is the tool against colluding guardians when the owner key is fine.

Freeze cap: after `MAX_FREEZE_STREAK` (2) freezes in a row by the same guardian set (a new freeze starting less than 4 x `FREEZE_PERIOD` after the previous one ended), a third is refused (`FreezeCapped`) until 4 periods of quiet have passed or the guardian set is changed (`applyGuardians` resets the streak). So colluding guardians can deny service for about 2 periods (prod 144 h) per 6-period cycle at most, and the owner can use the window after the second freeze to replace them (24 h timelock). A freeze cannot be extended while running (`AlreadyFrozen`).

Trust table (prod values; `L` = the Pocket's daily limit):

| Case | What the attacker can still do | For how long / how much |
|---|---|---|
| Lost phone (key lost, nobody has it) | Nothing is stolen. The owner cannot act. Guardians recover: threshold path (no veto comes, 48 h) or unanimous path (72 h). | 48 h to 72 h of no access after the guardians act. With fewer than `threshold` reachable guardians there is no recovery and the funds are stuck. |
| Stolen key, guardians honest | Before the freeze: spend up to `L` per UTC day immediately and queue larger spends (24 h timelock). After the freeze: nothing moves; the thief cannot veto the unanimous recovery; the thief's queue is killed at finalize. | Residual loss = what the thief takes before `threshold` guardians notice and freeze: at most `L` per UTC day of delay, `L x (floor(hours_to_freeze / 24) + 2)` worst case (the +2 is the UTC-midnight straddle: `L` just before and `L` just after midnight). Then frozen 72 h; recovery lands 72 h after the unanimous proposal. Needs ALL guardians reachable. If one is missing the unanimous path is closed, the thief vetoes any threshold recovery, freezes cap out at 2 x 72 h, and the thief goes back to draining `L` per day: unrecoverable. |
| Colluding threshold of guardians (owner key fine) | Freeze the Pocket (denial of service). Propose a threshold recovery to a key they own. They cannot do the unanimous path unless all collude, and they cannot spend. | Freeze at most 2 x 72 h per 6-period cycle (see the cap). A recovery proposal finalizes after 48 h unless the owner vetoes; an owner who is offline for 48 h loses the Pocket. Each re-proposal needs fresh signatures and costs the owner one veto intent. The owner can swap the guardians in the quiet window. |
| ALL guardians colluding (or all their keys stolen) | Take the Pocket: unanimous recovery cannot be vetoed, and while it is pending the owner cannot even move funds out (frozen). | Total loss 72 h after the proposal. Nothing in the contracts can stop this; it is the price of an owner-veto-free recovery path. The owner's only defence is the choice of independent guardians. |

Other facts that stay true:
- Guardian keys are read live from `pqcKeyStatus` (not pinned), so a guardian that rotates its on-chain key keeps its seat with the new key. Guardians must be PoP-proven accounts when they sign.
- A guardian change is timelocked (24 h) so a stolen key cannot instantly replace the guardians; it is also blocked while frozen or while any recovery is pending.
- The daily-limit drain before the freeze cannot be prevented by the contracts. Mitigations: low daily limit, guardians watching `SpendQueued` / `Spent` events, and acting fast. Anyone can submit the freeze (the router), so a relayer outage does not stop guardians.
- A pending unanimous recovery whose new key becomes unusable (`finalizeRecoveryUnanimous` fails closed) is repaired by a fresh unanimous proposal; until then the Pocket stays frozen. Only all guardians together can cause or repair this.
- Freeze and unanimous signatures bind chain id, vault address, action tag, a dedicated nonce (`freezeNonce`; `recoveryNonce` is shared by both recovery kinds, so a vetoed or replaced proposal's signatures are dead) and a deadline. A threshold-recovery signature cannot be reused as a unanimous one (different action tags).
- Guardian sets: 0 guardians (no recovery and no freeze at all), or 2..5 with threshold >= 2.

## 4. Browser key storage (no-wallet receivers)
- A receiver without QoreX gets an ML-DSA key generated in the browser (proven on Android and iPhone). Whoever can read that browser's storage controls the Pocket. Clearing site data loses the key. The product must offer a backup and add guardians; until the user does, an unrecovered loss means the funds are unrecoverable.
- QoreX users keep their key in the wallet; their intents are `signArbitrary` messages.
- A Pocket's pinned key hash does not follow later key rotations of the owner account: a rotation requires a guardian recovery (a deliberate trade-off).

## 5. Signing UX gap
- QoreX shows the signed message, which is `qorechain-msg-v1|qorechain-diana|0x<32-byte digest>`. A human cannot read parameters out of a hash; the dApp must show them next to the prompt. The contracts cannot enforce what the UI shows.
- The exact QoreX response shape for `signArbitrary` was confirmed offline against `@qorechain/qoresign` only; the live-wallet signature confirmation is the frontend's job.

## 6. The fixture mock
- Foundry cannot run the native precompiles. The tests use a signature-real mock: it accepts exactly the (pk, sig, message) triples listed in `test/fixtures/**` (real ML-DSA-87, generated by a committed node script and re-verified by `script/verify-fixtures.mjs`). It proves the contracts build and check the right bytes; it does not prove the chain's precompile agrees. The live suite (`test/live/run.mjs`, `LIVE_RESULTS.md`) does that on Diana.
- Because signatures are fixed fixtures, fuzz/invariant sequences walk a fixed grid of intents (nonces 0..59, a few amounts and recipients). Properties about forgery use random bytes.

## 7. Product / protocol limits
- DropPool uniqueness is per PoP ACCOUNT, not per human. A sybil with many PoP accounts can drain slots. Mitigations: small per-slot amounts, a slot cap (20), host close. The UI must say "distinct PoP accounts, not people".
- Daily limits and the daily drip cap are never credited back by cancel/refund/close (the allowance is debited when value is committed).
- `createDrop`/`createPool` over the remaining daily allowance revert (they do not queue); the owner must raise the limit (timelocked) first.
- Open-mode bound links cannot be cancelled by the sender; the escrow returns after expiry by `refund`. The drip and relayer fee are paid at the first bind even if the recipient never claims.
- `refund` / `close` / `withdraw` payouts to a hostile Pocket use a 100k-gas push and fall back to a pull balance; a Pocket's `receive` never reverts, so Pocket-to-Pocket payouts always push.
- A failed `create2` (pocket already exists) burns the forwarded gas; the router checks `isPocket` first so the normal path never hits it.
- Intents carry a deadline but cannot be revoked other than by consuming the nonce with another intent.
- The ML-DSA signature (4,627 bytes) makes intents large: a relayed spend is ~4.8 KB of calldata, a recovery proposal with two guardians ~9.5 KB. The public EVM gateway rejects raw txs of 64 KB and above (spike result), far above anything here.
- The deployed bytecode was compiled with solc 0.8.28, optimizer 200 runs, `bytecode_hash = none`; `node script/deploy.mjs --check` compares the on-chain runtime code with a local build (modulo immutables). The explorer has no source verification yet.
