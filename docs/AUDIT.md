# Pocket Drop - QCAI audit (v4 audited in two stages; v5 = v4 + strict PqcLib)

**Summary (one line, reused in the README and the project page):** two QCAI runs on the v4 contracts. Stage 1 scored 82 on 19 Nov 2026 and Stage 2 scored 78 on 20 Nov 2026. Both runs found the same 5 items. One is real and already bounded (ETH-004, at most 5 guardians); the rest are false positives. Each item maps to named Foundry tests below. The only change between the stages is a comment, and the bytecode is identical.

All of this runs on the Diana testnet (chain id 9800); QOR there has no monetary value.

**v5 (25 Nov 2026).** v5 changes one library, `PqcLib`, to close the hygiene item that used to be listed at the end of section 5.1 (exact ML-DSA-87 sizes and the exact key-status layout are now checked in the contract). The rest of `src/` is byte-for-byte the audited Stage 2 source. v5 is deployed on Diana and is the current version; v4 stays deployed as the previous version. A Stage 3 QCAI run on the v5 source has **not been run yet**: the audit is started from a signed-in dashboard account, not from a chain key (section 8). The v5 flattened source is ready in [`docs/audit/stage3/`](audit/stage3/). Details: [`docs/V5.md`](V5.md).

## 1. Reports

| Stage | Date (UTC) | Audit ID | Score / risk | PDF | JSON | Audited source |
|---|---|---|---|---|---|---|
| 1 | 2026-11-19 23:28 | `QCAIA-1795130931306-3D8DAA40` | 82 / MEDIUM | [`docs/audit/stage1/QCAI-stage1-2026-11-19.pdf`](audit/stage1/QCAI-stage1-2026-11-19.pdf) | [`.json`](audit/stage1/QCAI-stage1-2026-11-19.json) | [`stage1/PocketDrop-v4-flattened.sol`](audit/stage1/PocketDrop-v4-flattened.sol), 1601 lines, SHA-256 `a4fdacc97a798149c6ce0b15e46b9944c94fb5ecb11ab68d235440692ad32cd4` |
| 3 (v5) | not run yet | n/a | n/a | n/a | n/a | [`stage3/PocketDrop-v5-flattened.sol`](audit/stage3/PocketDrop-v5-flattened.sol), 1617 lines, SHA-256 `2b27a1498ff29dd73b4f1175e3e608f84c34dc9b2523b8c6c8e5bf8e2959e610` |
| 2 | 2026-11-20 01:32 | `QCAIA-1795138339351-F6A93427` | 78 / MEDIUM | [`docs/audit/stage2/QCAI-stage2-2026-11-20.pdf`](audit/stage2/QCAI-stage2-2026-11-20.pdf) | [`.json`](audit/stage2/QCAI-stage2-2026-11-20.json), SHA-256 `a1d587ebb749c6cd8601b47bbcf63f6cf4f5709e0b72f6168c114ba2eb30bbc7` | [`stage2/PocketDrop-v4-flattened.sol`](audit/stage2/PocketDrop-v4-flattened.sol), 1605 lines, SHA-256 `c4b19a8d00879b64417aece0d7dd65a20e1398285c4fbf895f19e78cdfe1b0cf` |

Public reports:
- Stage 1: https://dashboard.qorechain.io/api/proxy/audits/QCAIA-1795130931306-3D8DAA40
- Stage 2: https://dashboard.qorechain.io/api/proxy/audits/QCAIA-1795138339351-F6A93427

Both runs use the blockchain setting "Ethereum (EVM/Solidity)". The dashboard showed a cost of 150 QOR (testnet) for each run.

The flattened file joins IPocket (interfaces), PqcLib, Payout, PqGuard, PocketVault, PocketFactory, PocketRouter, PocketDrop and DropPool. Imports, repeated pragmas and SPDX lines are removed. Stage 1 audited repo HEAD `ca9a5e7`. The file compiles with `forge build` (solc 0.8.28, cancun). The example consumer `src/examples/PqGuardedCounter.sol` is not part of the audited file.

The dashboard's "Export PDF" button produced no download in the automated browser. Both PDFs were therefore rendered from the official JSON reports. The first page of each PDF says so, and the content is unchanged.

## 2. Stage 1 findings: resolution and tests

Resolution types: **fixed** (code changed), **regression test** (the behaviour is pinned by a named test), **false positive** (the claim does not hold; the test shows why). The line numbers in the report refer to the flattened file.

| ID | Severity | Location | Claim | Resolution | Tests (contracts-v4/test) |
|---|---|---|---|---|---|
| ETH-001 | HIGH | PocketVault `finalizeRecovery`, `finalizeRecoveryUnanimous` | Anyone can finalize recovery | **False positive.** Permissionless finalize is deliberate, and the NatSpec says so ("Anyone may call"). The caller chooses nothing. Finalize only applies a proposal that was already authorised by threshold guardian ML-DSA signatures or by all guardians. It runs only after the delay, and only if the new key still passes `PqcLib.requireKey`. The owner can veto a threshold proposal. | `test_finalized_recovery_kills_queued_spends_and_pending_changes`, `test_finalize_fails_closed_if_new_key_disappears`, `test_threshold_recovery_stays_vetoable_by_the_owner`, `test_unanimous_finalize_kills_queue_and_pending_changes`, `testFuzz_unanimous_recovery_is_not_vetoable`, `testFuzz_forged_recovery_never_proposes` |
| ETH-002 | MEDIUM | PocketDrop `_validateCreate` (daily drip sum) | Unchecked overflow in `_dripSpent + drip` | **False positive.** Solidity 0.8.28 uses checked arithmetic. `drip` is capped by `MAX_DRIP` (at most uint96) before the sum, and the sum is bounded by `DAILY_DRIP_CAP`. No `unchecked` block is involved. | `test_daily_drip_cap`, `testFuzz_drop_create_accounting` |
| ETH-003 | MEDIUM | PocketVault `_send` | Return value of a call not checked; reentrancy | **False positive.** `_send` reverts with `SendFailed` when the call fails. Every caller updates the nonce, the daily spend and the queue before the call, so a reentrant call finds the nonce consumed and the allowance debited. PocketDrop holds escrow and uses a `nonReentrant` lock. | `test_spend_to_self_and_send_failure`, `test_reentrant_pocket_is_blocked_by_the_lock`, `invariant_nonce_counts_successful_intents`, `invariant_vault_balance_conservation` |
| ETH-004 | LOW | PocketVault `_checkGuardianSigs` (nested loop) | Unbounded guardian loop; gas DoS | **Real, already bounded (regression test).** `_validateGuardians` enforces `MAX_GUARDIANS = 5`, so the worst case is a few iterations. No logic change. A comment at the loop now names the bound (commit `9c03147`, see section 4). | `test_max_five_guardians_accepted`, `test_bad_guardian_configs_revert`, `test_recovery_same_guardian_twice_and_non_guardian_fail` |
| ETH-005 | INFO | PocketVault `isValidSignature` | ERC-1271 not fully compliant | **False positive.** The function returns the magic value `0x1626ba7e` for a valid ML-DSA-87 signature over the QoreX-prefixed message, and `0xffffffff` otherwise, as the standard requires. The report names no concrete deviation. | `test_erc1271`, `test_pocket_and_plain_account_both_approve` (PqGuard) |

Counts: 5 findings (1 high, 2 medium, 1 low, 1 info). None needed a code fix; ETH-004 is documented in code.

## 3. Stage 2 findings: resolution and tests

Stage 2 reported the same counts (1 high, 2 medium, 1 low, 1 info). Three items repeat the Stage 1 claims. Two keep their IDs but name a different subject, so they are triaged here as new claims.

| ID | Stage 2 claim | Same as Stage 1? | Resolution | Tests |
|---|---|---|---|---|
| ETH-001 | Recovery finalize has no access control | Yes | **False positive**, same triage as section 2. | as in section 2 |
| ETH-002 | `_dripSpent + drip` overflow | Yes | **False positive**, same triage as section 2. | as in section 2 |
| ETH-003 (S2) | `Payout._pay` uses a raw call without checking the return value; reentrancy | No, new target | **False positive.** The return value is checked. `_pay` tests `_rawSend`; on failure it credits `pending[to]` and emits `PayoutDeferred` (pull payment) instead of reverting. The call is capped at `SEND_GAS` = 100,000 gas and copies no return data. Callers finish all state updates first and hold the `nonReentrant` lock in `Payout`. | `test_reverting_pocket_defers_payout_and_withdraw_works_later`, `test_gas_burning_pocket_cannot_block_claim`, `test_hostile_sender_cancel_is_deferred`, `test_reentrant_pocket_is_blocked_by_the_lock` (PocketDrop.t.sol), `test_reverting_pocket_defers_pool_payout` (DropPool.t.sol), `invariant_drop_balance_equals_unpaid_plus_pending`, `invariant_pool_balance_equals_unclaimed_plus_pending` |
| ETH-004 | Guardian loop | Yes, still reported with the comment in the audited source | **Real, already bounded**, as in section 2. The auditor did not mark it resolved. | as in section 2 |
| ETH-005 (S2) | PocketVault implements ERC-1271 but not ERC-165 | No, new claim | **False positive / not required.** ERC-1271 does not require ERC-165, and nothing in `src/` calls `supportsInterface` on a Pocket. Adding ERC-165 would change audited, deployed bytecode with no security benefit. | `test_erc1271` |

Other notes on the Stage 2 report:
- Its line numbers do not match the audited file. For example, flattened line 675 is a NatSpec line of the owner-veto function, not `finalizeRecovery`.
- It cites `src/` paths rather than the flattened file.
- Its gas suggestions (a mapping for the 5-entry guardian list, assembly address compares) are not adopted. They would change audited, deployed code for a negligible gain.

Outcome: no new real issue. ETH-004 is still the only real item, and it stays bounded by `MAX_GUARDIANS = 5`.

## 4. Why Stage 2 scored lower (82 → 78)

- **Change between the stages:** four NatSpec comment lines above `_checkGuardianSigs` in `contracts-v4/src/PocketVault.sol` (commit `9c03147`). They document the ETH-004 bound. There is no logic change.
- **Bytecode check:** `forge build --force` with solc 0.8.28, optimizer 200, `bytecode_hash = "none"` and `cbor_metadata = false`. The `deployedBytecode` of PocketVault, PocketFactory, PocketRouter, PocketDrop and DropPool is byte-for-byte identical before and after the comment. The deployed v4 contracts are therefore exactly the code audited in Stage 2.
- **Cause of the lower score:** the auditor is a model, and its output varies between runs on near-identical input. In Stage 2 it moved two findings to new targets (ETH-003, ETH-005) and kept ETH-004 open despite the comment. The 4-point drop reflects run-to-run variance, not a regression. Both scores are reported exactly as they came. The builder FAQ says a lower Stage 2 score is acceptable when the findings are answered.
- **Local results on the Stage 2 source:**
  - `forge test`: 167 passed, 0 failed, 0 skipped (14 suites).
  - `forge coverage --report summary`: 100.00% of lines, statements, branches and functions in every file under `src/`. PocketVault covers 258/258 lines, 324/324 statements, 60/60 branches and 42/42 functions. The "Total" row (98.95% of lines) also counts `test/` and `script/` files.
- **Charge evidence (Stage 2):**
  - The confirm dialog showed 150 QOR, and no wallet prompt appeared.
  - `eth_getBalance` of the paying address `0x8ab5...bBDd` read 405.825 QOR both before and after the run. The charge does not appear as an on-chain balance change at that address; the dashboard may bill a separate ledger.
  - The report is listed under "My audits".

## 5. Post-quantum design: every pqcVerify and pqcKeyStatus call site

QCAI only computes its "Quantum readiness" score for QoreChain-native contracts. It shows "Not scored" for an EVM-setting audit. That is expected and does not mean the contracts lack PQC. This section lists every place the contracts reach the two precompiles. It says what each call protects, which test pins it, and, where one exists, a live Diana transaction. The live hashes are re-checked by `node frontend/scripts/reverify.mjs`.

**Shared message format.** Every signed digest is turned into bytes by `PqcLib.pqMessage`: `"qorechain-msg-v1|qorechain-diana|0x<hex digest>"`. That is the QoreX `signArbitrary` format, so QoreX and browser-key users share one verification path. Each digest binds the chain id, the contract address and the action. Owner intents also bind the nonce and the deadline. Tests: `test_pqMessage_is_qorex_prefix_plus_hex_digest`, `testFuzz_pqMessage_matches_reference`, `test_digest_views_match_independent_encoding`, `test_digests_commit_to_everything`.

### 5.1 The two precompile wrappers (PqcLib)

| Call site | Precompile | What it guarantees | Tests (PqcLib.t.sol) |
|---|---|---|---|
| [`PqcLib.verify`](../contracts-v4/src/PqcLib.sol#L44-L54) | `pqcVerify` at `0x0A01` | True only if the call succeeds and returns exactly one 32-byte word equal to 1. Anything else (failure, no code, short or extra data, any other value) is false, never a revert. | `test_verify_true_only_for_exactly_one_word_equal_one`, `test_verify_false_variants`, `test_verify_false_when_precompile_has_no_code`, `test_verify_passes_exact_calldata`, `testFuzz_verify_never_reverts` |
| [`PqcLib.keyStatus`](../contracts-v4/src/PqcLib.sol#L59-L99) | `pqcKeyStatus` at `0x0A02` | Strict ABI decode of `(registered, algoId, pubkey, possessionProven)`. Non-boolean flags, a bad offset, an oversize key or short data all return `ok = false` (fail closed). | `test_keyStatus_valid_decode`, `test_keyStatus_fail_closed_on_call_failure`, `test_keyStatus_fail_closed_on_no_code`, `test_keyStatus_fail_closed_on_short_data`, `test_keyStatus_fail_closed_on_non_bool_flags`, `test_keyStatus_fail_closed_on_bad_offsets`, `test_keyStatus_fail_closed_on_bad_length`, `test_keyStatus_cap_boundary`, `testFuzz_keyStatus_never_reverts`, `testFuzz_keyStatus_mutated_word` |
| [`PqcLib.checkKey` / `requireKey`](../contracts-v4/src/PqcLib.sol#L148-L169) | `pqcKeyStatus` | The key must be registered, ML-DSA-87, have possession proven and, when a hash is pinned, match it. `requireKey` reverts with `KeyUnavailable`, `NotRegistered`, `UnsupportedAlgo`, `PossessionNotProven` or `KeyMismatch`. | `test_checkKey_codes`, `test_requireKey_reverts_per_code` |
| [`PqcLib.verifyFor` / `verifyForKey`](../contracts-v4/src/PqcLib.sol#L173-L186) | both | Reads the account's registered key with `checkKey`, then verifies with `verify`. Returns false (no revert) if the key is missing, unproven, of another algorithm, mismatched with the pinned hash, or the signature is wrong. | `test_verifyFor_uses_registered_key_and_exact_message` |

**Added 23 Nov 2026 (tests only, no source change, the audited bytecode is unchanged).**

| Property | Where | Tests |
|---|---|---|
| `keyStatus` on 18 shared raw-return vectors, two of them RECORDED from the Diana precompile (block 10,624,498): canonical layout is offset 0x80 and a 2,592-byte key | `contracts-v4/test/fixtures/keystatus/` | `KeyStatusVectors.t.sol`: `test_every_vector_decodes_as_recorded`, `test_live_diana_return_is_canonical_and_usable`, `test_live_key_without_possession_is_refused` |
| Owner key re-read from `pqcKeyStatus` on every intent: withdrawn PoP, other algorithm, unregistered, rotated registry key, missing key or verify precompile all refuse without consuming the nonce | `PqcLib.verifyForKey` via `PocketVault._auth` | `Hardening.t.sol`: `test_owner_key_status_is_re_read_on_every_intent`, `test_erc1271_applies_the_same_key_rules`, `test_missing_key_precompile_fails_closed`, `test_missing_verify_precompile_fails_closed` |
| New owner key must be proven at proposal and at finalization (threshold and unanimous) | `requireKey(newOwner, newKeyHash)` | `test_threshold_recovery_needs_a_proven_new_key_at_proposal_and_finalization`, `test_unanimous_recovery_needs_a_proven_new_key_at_proposal_and_finalization` |
| Expired and replayed intents never execute (any time after the deadline; any time after first use) | `_auth` | `testFuzz_expired_intent_never_executes`, `testFuzz_replayed_intent_never_executes` |
| No permanent lock: every live link and every pool unwinds after expiry from any reachable state | `PocketDrop.refund`, `DropPool.close`, `Payout.withdraw` | `invariant_every_live_link_can_be_unwound_after_expiry`, `invariant_every_pool_can_be_closed_after_expiry` |
| Signed bytes identical across the contracts' fixtures, the app and `@qorechain/qoresign`; all 596 fixture signatures reproduced byte for byte by qoresign | `PqcLib.pqMessage`, `frontend/src/lib/intents.ts` | `frontend/test/qoresign.diff.test.ts` |

**Fixed in v5 (25 Nov 2026).** Formerly listed here as a known limit (hygiene, not a finding we could exploit): the v4 `PqcLib` left the 4,627 / 2,592 byte sizes to the precompile and the pinned key hash, and accepted a key-status offset above 0x80. v5 checks both sizes before calling the precompile, requires a 2,592-byte registered key (`BadKeyLength`), and requires offset 0x80 with no trailing data. Tests: `test_v5_verify_refuses_wrong_sizes_before_the_precompile`, `testFuzz_v5_verify_true_only_at_exact_sizes`, `test_v5_keyStatus_refuses_trailing_data`, `test_v5_keyStatus_refuses_gap_between_head_and_tail`, `test_v5_checkKey_refuses_ml_dsa_87_key_of_wrong_length`. v4 text, kept for history: The API checks the sizes before relaying (`backend/src/pqPreflight.ts`). Changing `PqcLib` would need a redeploy and a new QCAI run; see `docs/THREAT_MODEL.md` section 5.

### 5.2 PocketVault (the smart account)

| Call site | Calls | What it protects | Tests | Live on Diana |
|---|---|---|---|---|
| [`initialize`, L214](../contracts-v4/src/PocketVault.sol#L214) `requireKey(owner_, 0)` | keyStatus | A Pocket can only be created for an owner with a registered, proven ML-DSA-87 key. That key's hash is pinned as `ownerKeyHash`. | `test_deploy_requires_registered_proven_owner_key`, `test_owner_key_is_pinned` | owner intent with lazy deploy `0x9c21d3ca…9cf4` |
| [`_auth`, L601](../contracts-v4/src/PocketVault.sol#L598-L602) `verifyForKey(owner, ownerKeyHash, …)` | both | Every owner action (spend, veto of a queued spend, limit and guardian changes, cancelling pending changes, recovery veto, and drop and pool create, confirm, cancel and close) needs an ML-DSA-87 signature by the pinned key over the next-nonce digest. The nonce is consumed before any effect. | `test_wrong_key_wrong_prefix_raw_digest_are_rejected`, `test_wrong_nonce_wrong_params_wrong_deadline_rejected`, `test_replayed_intent_reverts`, `test_intent_for_one_vault_does_not_work_on_another`, `test_veto_by_non_owner_key_reverts`, `testFuzz_forged_owner_intents_never_execute`, `invariant_nonce_counts_successful_intents` | another proven key, reverted BadSignature: `0x312c0fe1…0dcb`; replay, reverted BadSignature: `0x54d99c1e…7fec` |
| [`isValidSignature`, L233](../contracts-v4/src/PocketVault.sol#L233) | both | ERC-1271: other contracts can accept a Pocket's ML-DSA-87 approval. The check is the same as in `_auth`, with the pinned key. | `test_erc1271` | QoreX `signArbitrary` intent through the prod router: `0xf98daf5e…6d1a` |
| [`proposeRecovery`, L365 and L367](../contracts-v4/src/PocketVault.sol#L353-L370) | `_checkGuardianSigs`, then `requireKey(newOwner, newKeyHash)` | Threshold guardians must each sign with their own registered key. The new owner key must already be registered and proven, and match the proposed hash. | `test_recovery_happy_path_and_old_key_dies`, `test_recovery_with_one_of_three_guardians_fails`, `test_recovery_wrong_message_and_foreign_vault_signatures_fail`, `test_recovery_with_bad_hash_signed_by_guardians`, `testFuzz_forged_recovery_never_proposes` | |
| [`finalizeRecovery`, L388](../contracts-v4/src/PocketVault.sol#L384-L392) | keyStatus | Re-checks the new key at finalize time. If it was removed or replaced in the meantime, the recovery fails closed. | `test_finalize_fails_closed_if_new_key_disappears` | |
| [`proposeRecoveryUnanimous`, L414 and L415](../contracts-v4/src/PocketVault.sol#L402-L418) | `_checkGuardianSigs`, then `requireKey` | Stolen-key path: all guardians sign, the old key cannot veto, and the new key must be proven. | `test_unanimous_recovery_old_key_cannot_veto`, `test_stolen_key_scenario_end_to_end`, `test_unanimous_needs_all_guardians_after_a_set_change`, `testFuzz_forged_freeze_and_unanimous_never_succeed`, `invariant_old_key_cannot_veto_unanimous_recovery` | unanimous recovery finalized: `0x97aa69e5…5494`; old key afterwards, reverted BadSignature: `0x3aee0b02…4f4c` |
| [`finalizeRecoveryUnanimous`, L429](../contracts-v4/src/PocketVault.sol#L425-L432) | keyStatus | As for `finalizeRecovery`: fails closed if the new key disappears. | `test_unanimous_can_be_replaced_and_fails_closed_if_key_disappears`, `test_unanimous_finalize_kills_queue_and_pending_changes` | |
| [`guardianFreeze`, L464](../contracts-v4/src/PocketVault.sol#L456-L470) | `_checkGuardianSigs` | A threshold of guardian ML-DSA signatures freezes spending for a fixed period. The owner key cannot lift a freeze. | `test_freeze_happy_path_and_auto_expiry`, `test_freeze_signatures_cannot_be_replayed_and_cannot_stack_while_frozen`, `test_owner_key_cannot_lift_a_freeze`, `invariant_no_spend_or_execute_succeeds_while_frozen` | guardian freeze 2 of 3: `0xa0042ee4…56cf`; thief spend while frozen, reverted Frozen: `0xd4ca2455…f416` |
| [`_checkGuardianSigs`, L630](../contracts-v4/src/PocketVault.sol#L621-L632) `verifyFor(signer, …)` | both | Each signer must be a distinct configured guardian with a valid signature from its own registered key. The loop is bounded by `MAX_GUARDIANS = 5` (ETH-004). | `test_recovery_same_guardian_twice_and_non_guardian_fail`, `test_max_five_guardians_accepted`, `test_old_guardian_signatures_cannot_be_replayed_after_veto` | |

### 5.3 PocketDrop (send by link)

| Call site | Calls | What it protects | Tests | Live on Diana |
|---|---|---|---|---|
| [`bind`, L184](../contracts-v4/src/PocketDrop.sol#L184) `verify(linkPk, …)` | pqcVerify | The one-time link key (ML-DSA-87, carried in the link fragment) signs which recipient, key hash and payout address the link binds to. A mempool observer cannot swap the recipient. | `test_bind_rejects`, `test_bind_state_expiry_and_rebind`, `test_digests_commit_to_everything` | thief swaps the recipient, reverted BadLinkSignature: `0xf72a9a09…6318` |
| [`claim`, L237](../contracts-v4/src/PocketDrop.sol#L237) `requireKey(recipient, recipientKeyHash)` | pqcKeyStatus | The recipient must hold a registered, proven ML-DSA-87 key that matches the key hash bound at `bind`. | `test_claim_key_requirements` | no proof of possession, reverted PossessionNotProven: `0x4664a69a…5b5b` |
| [`claim`, L238](../contracts-v4/src/PocketDrop.sol#L238) `verify(pk, recipientSig, …)` | pqcVerify | The recipient signs the claim, including `payTo`, with that key. | `test_claim_signature_checks`, `test_confirmed_claim_pays_the_pocket`, `test_full_journey_sender_pocket_to_recipient_pocket_through_the_router` | claim lands in the recipient Pocket: `0x94d872a4…a275` |

### 5.4 DropPool (one link, many claimers)

| Call site | Calls | What it protects | Tests | Live on Diana |
|---|---|---|---|---|
| [`claim`, L106](../contracts-v4/src/DropPool.sol#L106) `verify(linkPk, …)` | pqcVerify | The pool's link key approves this claimer and payout address. | `test_claim_rejects_bad_inputs`, `test_digests` | |
| [`claim`, L109](../contracts-v4/src/DropPool.sol#L109) `requireKey(recipient, 0)` | pqcKeyStatus | Only accounts with a proven ML-DSA-87 key can take a slot (one slot per account). | `test_account_without_pop_cannot_claim`, `test_same_account_cannot_claim_twice`, `invariant_one_slot_per_account_and_never_beyond_slots` | no PQ key, reverted NotRegistered: `0x634daaba…3e26` |
| [`claim`, L110](../contracts-v4/src/DropPool.sol#L110) `verify(pk, recipientSig, …)` | pqcVerify | The claimer signs with that key. | `test_two_distinct_claimers_get_paid_into_pockets` | |

### 5.5 PqGuard (drop-in check for other dApps)

| Call site | Calls | What it protects | Tests (PqGuard.t.sol) |
|---|---|---|---|
| [`isPqApproved`, L25](../contracts-v4/src/PqGuard.sol#L25) `verifyFor(account, …)` | both | Lets a plain PoP-proven ML-DSA account approve a digest. Contract accounts such as Pockets go through ERC-1271 (`PocketVault.isValidSignature`, above). | `test_pocket_and_plain_account_both_approve`, `test_replay_and_cross_account_signatures_fail`, `test_undeployed_pocket_and_non_pop_account_fail_closed`, `test_hostile_contract_accounts_are_false_not_reverts`, `testFuzz_random_signature_never_approves` |

`src/examples/PqGuardedCounter.sol` is a small consumer of PqGuard. It is deployed as the shared counter `0x5ae81c71b7ff0c93886df8fe7502f3c846c3835f` and is not part of the audited file.

**ECDSA.** No spend or recovery path uses an ECDSA authority. The relayer's secp256k1 key only pays gas. Through the chain's scoped EVM window it can only call an allow list: the two v4 routers and the v3 drop contract. A Pocket refuses any intent without the owner's ML-DSA-87 signature.

### 5.6 For jurors: the two Solidity PQC features, checked by hand

The project page can only show "Solidity PQC signature check" and "Solidity PQC key status" as Declared: the FAQ says these two features never turn Verified automatically and jurors check them in the repository. This is where to look, and how to confirm the deployed bytecode really calls the precompiles.

| Feature | Source | Deployed on Diana (v4 PROD, deployer `qor18yh4pvv4t2p8gk9ryqs9uxdv7lrxfugkaksdhq`) | Deployment tx (status 1) |
|---|---|---|---|
| pqcVerify `0x…0a01` and pqcKeyStatus `0x…0a02` | [`PqcLib.sol` L14-L16](../contracts-v4/src/PqcLib.sol#L14-L16) (constants), `verify` L44-L54, `keyStatus` L59-L99 | PocketVault implementation `0x899b289ef60444ac74d82dea5cacc6637a2a29c3` (every Pocket is an EIP-1167 clone of it) | `0x220d854be6d942af2e0f32bb8ca47794ee027967b2df27c95d91c0ec6ca245bc` |
| same | [`PocketDrop.sol`](../contracts-v4/src/PocketDrop.sol) bind / claim | PocketDrop `0xbc13b9ee91f31ed56932abdb796693515c351f00` | `0x5c69b08bd9d8201c56d9a54ee76cfaafe766460b29e6f06412c5299f2500aa7c` |
| same | [`DropPool.sol`](../contracts-v4/src/DropPool.sol) claim | DropPool `0xaa981588e5430e3db9a789a3754e108cc01e3d00` | `0xf44405b57d8bb41c15e6e59cc9ec84c65e936cdf5f7c5da7050473983d2e360a` |

Bytecode check (read 23 Nov 2026, 19:40 Cairo): the runtime code of all three contains `PUSH2 0x0a01` (`610a01`) and `PUSH2 0x0a02` (`610a02`), the precompile addresses. Re-check with `eth_getCode` on `https://evm-testnet.qore.host`. Live accepted and refused calls for both features are in sections 5.2-5.4 and on `/judges`.

## 6. Reproduce

```bash
cd contracts-v4
forge test                                   # 185 tests (v5), mock precompiles
FOUNDRY_PROFILE=realcrypto forge test        # 22 tests, real ML-DSA-87 via vm.ffi (needs npm ci in contracts-v4)
FOUNDRY_PROFILE=live forge test              # 27 tests, eth_call against the live Diana precompiles
sh script/ffi/mutation-check.sh              # accept-all verifier must break the real-crypto suite
node script/probe-precompiles.mjs            # precompile conformance probe (eth_call only)
forge coverage --report summary              # 100% on src/
node ../frontend/scripts/reverify.mjs        # re-checks every recorded live hash and both deployments on Diana
```

## 7. Testing beyond mocks (added 25 Nov 2026)

The default suite replaces the two precompiles with Solidity mocks. Three further layers check the real thing.

| Layer | What it proves | Where | Count |
|---|---|---|---|
| Real-crypto suite | Every signature in these tests is a real ML-DSA-87 signature. The `pqcVerify` stand-in calls out (`vm.ffi`) to two independent ML-DSA-87 implementations and accepts only when both agree. Covers spend, replay, tamper, a single flipped bit, wrong key, truncated / oversized / empty signatures, wrong domain, chain id, nonce and deadline, a rotated registry key, truncated keys, ERC-1271, guardian freeze, both drop modes and pool domain separation. | `contracts-v4/test-real/`, `contracts-v4/script/ffi/mldsa.mjs` | 22 tests |
| Mutation check | With the verifier forced to accept everything, the real-crypto suite must fail. It does: 18 of 22 tests fail (the 4 that pass do not depend on a signature being rejected). | `contracts-v4/script/ffi/mutation-check.sh`, CI job `contracts-realcrypto` | 18 / 22 fail as required |
| Live profile | The same 22 tests rerun with `pqcVerify` answered by the live Diana precompile (eth_call), plus 5 tests on live key status and on a fork (a fork has no precompile code, and `PqcLib` fails closed there). | `contracts-v4/test-live/`, CI job `contracts-live` | 27 tests |
| Precompile conformance | 43 eth_call cases against 0x0A01 / 0x0A02, compared with FIPS 204: 0 anomalies in 28 reached verify cases. Wrong sizes, ML-DSA-65 / 44, context and internal-API signatures return false (no revert). The key-status bytes offset is always 0x80. An empty message is refused at block 10,654,799 and accepted from 10,654,800 (archive query), an independent reproduction of a chain change; Pocket Drop never signs an empty message. The recorded answers are replayed against `PqcLib` in CI. | [`docs/PRECOMPILE_CONFORMANCE.md`](PRECOMPILE_CONFORMANCE.md), `contracts-v4/test/PrecompileConformance.t.sol` | 3 tests over the recorded answers |

v5 on chain: the deploy transactions of all 11 contracts and their runtime code hashes are in `contracts-v4/deployments/diana.json` (`v5`), re-checked by `reverify.mjs`. A live smoke on the v5 production instance (one drop sent, bound, claimed by a newcomer whose key registration was paid by the drip; one pool hosted, claimed and closed) is in [`contracts-v4/LIVE_RESULTS.md`](../contracts-v4/LIVE_RESULTS.md), section "v5 deploy and live smoke".

## 8. Stage 3 (v5): how to run it

The QCAI auditor runs from the dashboard (`dashboard.qorechain.io/audit`, sidebar Build > AI Audit) and needs a signed-in dashboard account (email or identity provider). It cannot be started from a chain key or an API. Per the QoreChain docs, the first audit each UTC day is free; on testnet, extra audits are paid in test QOR from the dashboard's own test wallet after a "Confirm Security Audit" dialog (earlier runs showed 150 QOR).

1. Sign in, open AI Audit, set Blockchain to **Ethereum (EVM/Solidity)** (the setting used for Stages 1 and 2).
2. Name: `PocketDrop v5 (strict PqcLib)`. Paste `docs/audit/stage3/PocketDrop-v5-flattened.sol` (SHA-256 above).
3. Run Security Audit, then confirm. Make the report public.
4. Save the JSON from `https://dashboard.qorechain.io/api/proxy/audits/<id>` as `docs/audit/stage3/QCAI-stage3-<date>.json`, fill the Stage 3 row in section 1, and triage the findings like sections 2 and 3.
