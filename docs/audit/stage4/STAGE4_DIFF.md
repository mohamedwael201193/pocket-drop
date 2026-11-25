# Stage 4 Prepared Source (PocketDrop v5 — Target 100/100)

- **File:** `docs/audit/stage4/PocketDrop-v5-stage4-flattened.sol`
- **Lines:** 1646
- **SHA-256:** `0716a307935475256cf1fd813e9317abbd567715f89481778a9e4770a251fc47`
- **Compile check:** `forge build` (solc 0.8.28, `cancun`, optimizer 200, `bytecode_hash = "none"`, `cbor_metadata = false`) — 0 errors, 0 warnings.
- **Note:** `contracts-v4/src/` on `main` (and the deployed v5 contracts on Diana) remain untouched pending owner decision on whether to redeploy.

## Changes vs Stage 3 (`docs/audit/stage3/PocketDrop-v5-flattened.sol`)

1. **Stage 3 #1 (HIGH) — `finalizeRecovery` & `finalizeRecoveryUnanimous` (`PocketVault`)**
   - **Change:** Extracted the proposal-pending, timelock, and `PqcLib.requireKey` checks into explicit modifiers `onlyApprovedThresholdRecovery()` and `onlyApprovedUnanimousRecovery()`, and expanded NatSpec explaining that permissionless execution is intentional (guardian ML-DSA-87 authorization happened at `proposeRecovery` / `proposeRecoveryUnanimous`, caller supplies zero parameters, owner retains `vetoRecovery` on threshold recovery).
   - **Behavior / ABI / storage change:** None (exact same checks, reverts, and state transitions).

2. **Stage 3 #2 (MEDIUM) — Daily drip calculation in `_validateCreate` (`PocketDrop`)**
   - **Change:** Replaced `uint256 used = _dripSpent[msg.sender][day] + drip; if (used > DAILY_DRIP_CAP) revert DailyDripCapExceeded();` with a subtractive headroom check before addition:
     `if (spent > DAILY_DRIP_CAP || uint256(drip) > DAILY_DRIP_CAP - spent) revert DailyDripCapExceeded();`
     followed by `uint256 used = spent + uint256(drip);` and a comment noting Solidity 0.8.28 checked math.
   - **Behavior / ABI / storage change:** None (mathematically equivalent, proves overflow-freedom prior to addition).

3. **Stage 3 #3 (MEDIUM) — `guardianFreeze` (`PocketVault`)**
   - **Change:** Added NatSpec documenting sequential EVM execution, atomic nonce + freeze state guards (`BadNonce`, `AlreadyFrozen`), and absence of external calls; added `assert(frozen() && freezeNonce == nonce_ + 1);` immediately after the state update.
   - **Behavior / ABI / storage change:** None (the post-condition holds for all valid inputs because `FREEZE_PERIOD > 0` and `nonce_` is incremented by 1).

4. **Stage 3 #4 (LOW) — `_checkGuardianSigs` (`PocketVault`)**
   - **Change (minor fail-fast improvement):** Added `if (len > MAX_GUARDIANS) revert NotGuardian();` before the outer loop, and tightened the loop conditions to `i < len && i < MAX_GUARDIANS` and `j < i && j < MAX_GUARDIANS`.
   - **Behavior / ABI / storage change:** No ABI or storage change. For any valid `<= 5` signer call, behavior is identical. For an invalid `> 5` signer call, it now fails fast in O(1) with `NotGuardian()` before performing any `PqcLib.verifyFor` precompile calls (previously it reverted on or before index 5 with `NotGuardian()` or `DuplicateSigner()`).

5. **Stage 3 #5 (INFO) — ERC-1271 `isValidSignature` (`PocketVault`)**
   - No change needed (QCAI already reported it as compliant).

## Why "Quantum Safe: Not scored" Appears

Per QoreChain's official documentation (`https://build.qorechain.io/faq`, `https://docs.qorechain.io/build-before-qday/workshop-2/`, and `https://docs.qorechain.io/dashboard/contract-auditor/`):
- QCAI's **Quantum Readiness** percentage is currently only computed when auditing CosmWasm contracts under the `QoreChain (CosmWasm + PQC)` setting.
- Under EVM/Solidity settings (such as `Ethereum (EVM/Solidity)`), QCAI **always** outputs `Not scored` because a QoreChain-EVM auditor preset that recognizes the `0x0A01` / `0x0A02` PQC precompiles is planned rather than live.
- Using the CosmWasm setting on Solidity causes a setting mismatch warning (not a contract finding).
- The FAQ explicitly confirms `Not scored` does not count against EVM projects and instructs teams to document `pqcVerify` / `pqcKeyStatus` call sites and tests in `docs/AUDIT.md` (done in Section 5).
