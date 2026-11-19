# Security notes: Pocket Drop v4 contracts (Diana testnet only)

Honest status: unaudited testnet code. Not for mainnet. The `pqcVerify` / `pqcKeyStatus` precompiles are active on Diana only. See `KNOWN_ISSUES.md` for what this design does NOT protect against.

## What is protected, and how
Every sensitive action of a Pocket (`PocketVault`) is an **ML-DSA-87 intent**: the owner signs the bytes

    "qorechain-msg-v1|qorechain-diana|" + "0x" + lowercase-hex(keccak256(abi.encode(action, chainid, vault, nonce, deadline, params)))

and the contract checks the signature with `pqcVerify` against the key that `pqcKeyStatus(owner)` reports (registered, algo 1, `possessionProven`), additionally pinned to the key hash recorded at init. These are exactly the bytes QoreX `signArbitrary` signs (qoresign `messagePqSignBytes`; chain id string is the native `qorechain-diana`, not 9800). The format lives in ONE function, `PqcLib.pqMessage`. Browser-key signers and QoreX users take the same code path. Drop bind/claim and Pool link/claim signatures use the same wrapper.

Anyone may submit an intent (the relayer); authority is only the signature. The relayer's EVM window is scoped to the routers, so the chain refuses any other target at broadcast (live evidence in `LIVE_RESULTS.md`).

## Per-contract guarantees (each has unit + fuzz + invariant tests, 100% line/branch coverage)
- **PqcLib**: fail closed. A failed precompile call or malformed/short return data gives `false` / `ok == false`; the key-status return data is bounds-checked by hand.
- **PocketFactory**: EIP-1167 clones at CREATE2 addresses; the salt commits to (owner, guardians, threshold, daily limit, user salt), so an address pins its configuration and can be funded before it exists. `isPocket` is true only for factory deployments.
- **PocketVault**
  - single sequential owner nonce, consumed only on success; deadline checked; the digest binds chain id, vault address, action tag, nonce, deadline and every parameter. A replayed, re-addressed, re-parameterised or late intent fails.
  - `spend` pays now only within today's UTC-day allowance; above it the spend is queued for `TIMELOCK` and the owner can veto; `executeQueued` is permissionless after the delay.
  - `setLimit`: lowering is immediate and cancels a pending raise; raising is queued for `TIMELOCK` (`applyLimit`).
  - `setGuardians` is also queued for `TIMELOCK` (see deviations); `cancelPending` clears both queues.
  - recovery: `threshold` (>= 2) distinct guardians sign `recoveryDigest(newOwner, newKeyHash, deadline)` with their own PoP-proven ML-DSA keys; `RECOVERY_DELAY`; the CURRENT owner key can veto; `finalizeRecovery` re-checks that the new key is registered, proven and equals `newKeyHash`. Guardian signatures are bound to a separate `recoveryNonce` that increments on every proposal, so a vetoed proposal's signatures cannot be replayed.
  - while a recovery is pending, queued spends, limit raises and guardian changes cannot execute; a finalized recovery bumps `epoch`, killing everything the old key queued, and clears pending limit/guardian changes.
  - `createDrop` / `createPool` debit the daily allowance (otherwise a stolen key could move value around the limit through a link-key claim).
  - ERC-1271 `isValidSignature(hash, sig)` is valid only for the owner's ML-DSA signature over the prefixed message of `hash`.
- **PocketRouter**: forwards only to factory Pockets, `PocketDrop`, `DropPool`; lazy-deploys through the factory. Stateless, no admin. Balances it receives (PocketDrop pays the relayer fee to its caller, which is the router) are swept to the router's caller.
- **PocketDrop v4**: v3 semantics (bind by link key, confirm, claim, cancel, refund, pull-payment fallback, reentrancy lock, CEI) plus: bind/claim digests commit to `payTo` (the recipient's Pocket) so a mempool thief who swaps the payout address invalidates the link signature; the claim requires `PqcLib.requireKey(recipient, recipientKeyHash)`; confirmation is an intent executed by the sender's Pocket (`confirmRecipient`); the drip goes to the recipient ACCOUNT (it pays for its PQ-key registration), the escrow to the Pocket.
- **DropPool**: one slot per PoP-proven recipient ACCOUNT (not per human), link-key signature + recipient signature per claim, small configurable caps, host close/refund.
- **PqGuard**: `requirePqApproval(account, digest, sig)`: Pocket (ERC-1271 via `staticcall`, malformed/short return is `false`) or PoP-proven account.

## Invariants (invariant tests: 256 runs x depth 50 in the CI profile)
1. Pocket QOR conservation: every wei that left was an immediate spend or an executed queued spend; queued spends never execute early, never twice; the daily-allowance rule holds.
2. PocketDrop: `balance == sum(unpaid escrow of live links) + sum(pull balances)` exactly; a link pays at most once; claims/binds follow the state machine; terminal links hold nothing.
3. DropPool: `balance == sum(unclaimed of open pools) + pull balances`; one claim per account per pool; `taken <= slots`.

## Test evidence
- Fixtures are REAL ML-DSA-87 keys and signatures (`script/gen-fixtures.mjs`, deterministic seeds, library `@qorechain/pqc`), over the exact prefixed message. `script/verify-fixtures.mjs` re-verifies all of them with the real verifier and checks that wrong-key, bit-flipped and mutated-message inputs are rejected.
- The Foundry mock of `pqcVerify` accepts ONLY a (pk, sig, message) triple whose keccak was loaded by the test from those fixtures. It is not a "return true" mock. It is still not the chain's precompile: the live suite (`LIVE_RESULTS.md`) is the end-to-end proof.
- Solidity digests are cross-checked against an independent JS (viem) encoding: the Pocket addresses, bind/claim/pool digests and every intent digest are computed in JS and must match, otherwise the fixture signature does not verify.

## Slither 0.11.6 (`slither-report.txt`, `python -m slither . --filter-paths "lib|test|node_modules"`)
Fixed: `missing-inheritance` (PocketDrop / DropPool now implement the sender/host interfaces). Everything else is reviewed and accepted:
- `arbitrary-send-eth` (`PocketVault._send/createDrop/createPool`, `PocketRouter._sweep`): the destination is chosen by an ML-DSA-signed intent (owner) or is the router's own caller (relayer fee). By design.
- `reentrancy-events`: events emitted after a trusted/owner-chosen external call; state is already final (CEI), no state is written after the call.
- `unused-return`: `PqcLib.requireKey` is called for its revert, the returned key is not needed.
- `missing-zero-check`: `PocketVault.initialize` rejects `owner == 0` in `_validateGuardians`; router `drop_`/`pool_` are deploy-time immutables (a zero disables that target).
- `timestamp`: expiry, deadlines and delays are minutes to days; a miner can move a timestamp by seconds only.
- `incorrect-equality`: comparisons with the zero sentinel (`value == 0`, `at == 0`, `bal == 0`) and the day index.
- `assembly` / `low-level-calls` / `too-many-digits`: precompile `staticcall`s, the return-bomb-safe `call`, the EIP-1167 creation code literal. Covered by tests (PqcLib has fuzzing against malformed data; the clone address is checked against an independent JS CREATE2 computation).
- `naming-convention`: UPPER_CASE immutables mirror v3 / the spec.

## SPEC deviations (all tightenings, all safe)
1. `PocketFactory.predict/deploy` take the full config `(owner, guardians, threshold, dailyLimit, userSalt)` instead of `(owner, salt)`: the spec says the salt commits to the whole config, which needs the config as input. Owner key hash is read from `pqcKeyStatus` at `initialize` (the owner must already be registered with PoP) rather than passed in.
2. `setGuardians` is timelocked (`applyGuardians`) like a limit raise, and `cancelPending` was added.
3. Pending recovery blocks `executeQueued` / `applyLimit` / `applyGuardians`; finalized recovery invalidates old queued spends (`epoch`).
4. `createDrop` / `createPool` debit the daily allowance; there is no queueing for them (over-allowance reverts `OverDailyLimit`).
5. `createPool` / `closePool` were added to the Pocket (a Pocket must be able to host a pool; the spec lists only the drop calls).
6. Guardian sets are 0 guardians, or 2..5 with 2 <= threshold <= n (spec: 2-of-3 recovery). Zero guardians is allowed because a newcomer's Pocket exists before guardians do.
7. `PocketDrop.confirm(linkId)` (v3) was dropped: confirmation always pins the recipient key hash (`confirmRecipient`). Bind/claim digests are `POCKETDROP_*_V2` and include `payTo`.
8. `PocketDrop` does not enforce that the sender is a Pocket (it is a generic escrow; the sender is whatever calls `create`). Enforcing it would need a factory dependency cycle (factory <-> drop). The product only creates links through Pockets.
9. The vault trusts the owner-signed `drop` / `pool` address in `createDrop` / `createPool`. A signing UI must show it.
10. A failed `create2` (address already deployed) consumes the forwarded gas; the router avoids it by checking `isPocket` first.
