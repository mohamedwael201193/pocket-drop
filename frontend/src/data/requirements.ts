// /judges requirement table: each Post-Quantum dApp requirement -> code -> live transaction -> test.
// Every hash below is mined on Diana testnet and is re-checked by `node frontend/scripts/reverify.mjs`
// (EVM hashes against evm-testnet.qore.host, Cosmos hashes against the REST API). Line anchors point at main.
export interface ReqLink { label: string; path: string }
export interface ReqTx { label: string; hash?: string; note?: string }
export interface Requirement { id: string; requirement: string; code: ReqLink[]; live: ReqTx[]; liveHealth?: boolean; tests: string[] }

export const REQUIREMENTS: Requirement[] = [
  {
    id: 'pqc-verify',
    requirement: 'Solidity PQC signature check (pqcVerify, 0x0A01) on every action that moves money',
    code: [
      { label: 'PqcLib.verify', path: 'contracts-v4/src/PqcLib.sol#L44-L54' },
      { label: 'PocketVault._auth', path: 'contracts-v4/src/PocketVault.sol#L598-L602' },
      { label: 'PocketDrop bind / claim', path: 'contracts-v4/src/PocketDrop.sol#L184' },
    ],
    live: [
      { label: 'owner intent accepted (lazy deploy + spend)', hash: '0x9c21d3cae77ef1ae9af98e0d560036982e50a8e2b9d7ff9c0ec762d84e229cf4' },
      { label: 'intent signed by another proven key: reverted BadSignature', hash: '0x312c0fe1ecfe1a0159618152ade48639139671adbda5336b4132d06f2a830dcb' },
      { label: 'replayed intent: reverted BadSignature', hash: '0x54d99c1e8b04744df5a0360a5dd7b0a02b3066d7f39794a5af97f90ba6957fec' },
    ],
    tests: ['test_wrong_key_wrong_prefix_raw_digest_are_rejected', 'test_replayed_intent_reverts', 'test_verify_false_variants', 'test_verify_passes_exact_calldata', 'test_missing_verify_precompile_fails_closed', 'testFuzz_expired_intent_never_executes', 'testFuzz_replayed_intent_never_executes', 'frontend test/qoresign.diff.test.ts (596 fixture signatures reproduced byte for byte by @qorechain/qoresign)', 'backend test/pqPreflight.test.ts (4,627-byte signatures and 2,592-byte keys checked before relaying)'],
  },
  {
    id: 'pqc-key-status',
    requirement: 'Solidity PQC key status (pqcKeyStatus, 0x0A02): registered ML-DSA-87 key with proof of possession, pinned by hash',
    code: [
      { label: 'PqcLib.keyStatus / requireKey', path: 'contracts-v4/src/PqcLib.sol#L59-L99' },
      { label: 'PocketDrop claim', path: 'contracts-v4/src/PocketDrop.sol#L237-L238' },
      { label: 'DropPool claim', path: 'contracts-v4/src/DropPool.sol#L109-L110' },
    ],
    live: [
      { label: 'claim into a key without proof of possession: reverted PossessionNotProven', hash: '0x4664a69a207575641d38bcf3af724d9f81753c275dd8312c2a66fb3b18be5b5b' },
      { label: 'claim into an account with no PQ key: reverted NotRegistered', hash: '0x634daabad61a5506cee38d3d7e262a9fd83d901e39445fd1eb07ce87a2073e26' },
    ],
    tests: ['test_claim_key_requirements', 'test_account_without_pop_cannot_claim', 'test_deploy_requires_registered_proven_owner_key', 'test_requireKey_reverts_per_code', 'test_owner_key_status_is_re_read_on_every_intent', 'test_every_vector_decodes_as_recorded', 'test_live_diana_return_is_canonical_and_usable', 'frontend test/keystatus.test.ts (strict decoder, same vectors)'],
  },
  {
    id: 'key-registration',
    requirement: 'PQC key registration with proof of possession, from the browser, with the QoreChain SDK',
    code: [
      { label: 'recipient key registration (signProofOfPossession + buildRegisterPqcKeyMsg)', path: 'frontend/src/lib/recipient.ts#L72-L73' },
    ],
    live: [
      { label: 'a newcomer with 0 QOR registers its ML-DSA-87 key (fee paid from the drip)', hash: 'D98528C61DACD8A81B7EBE87450A603F2979819A84C3877647F5B8DA232A3D2D' },
    ],
    tests: ['e2e v4.spec.ts "a. Confirmed drop … claim into the recipient Pocket"', 'reverify.mjs check 8 (Cosmos hashes, code 0)'],
  },
  {
    id: 'hybrid-relay',
    requirement: 'Hybrid-signed relays: every relay is a MsgCrossVMCall signed secp256k1 + ML-DSA-87 and checked by the chain; no ECDSA-only path is open',
    code: [
      { label: 'createHybridRelayer (sign, dry run, broadcast once)', path: 'backend/src/hybridRelayer.ts' },
      { label: 'cosmos tx reader (pqc_hybrid_verify, EVM result)', path: 'backend/src/cosmos.ts' },
    ],
    live: [
      { label: 'v4 createDrop relayed hybrid: code 0, pqc_hybrid_verify=verified', hash: '04AA17839F57179DA8EC58454F1CD1CEBDDA4D883C86376B4CD92720AF56D445' },
      { label: 'v3 claim relayed hybrid: code 0, verified', hash: 'CAFECB9ABD82E5715DAE1EB721D8332E10631370F62A15F26384825EAB98F71C' },
      { label: 'Q-Day attempt with a published classical key: the relay signature verified, the Pocket refused the call (code 14)', hash: 'FB826A14E7E1A8A6271E9489E2BA12BF17075CC793479720F981594F758F00D3' },
    ],
    liveHealth: true,
    tests: ['backend test/hybrid.test.ts "createHybridRelayer"', 'reverify.mjs section 9 (every recorded hybrid relay: code and pqc_hybrid_verify)'],
  },
  {
    id: 'scoped-window',
    requirement: 'Scoped EVM window, two kinds. (1) Per user, "Relay it yourself": the user\'s own account opens a hybrid-signed window scoped to the one v5 router (about 9 minutes, 3 txs) and submits its own claim or spend; the app offers it when the relayer is down or slow, or always (Advanced setting on /pocket). (2) The relayer\'s fallback window, scoped to the routers with tx and value caps, closed while relays are hybrid',
    code: [
      { label: 'selfRelay.ts (own router-only window, then the router call from the user\'s account)', path: 'frontend/src/lib/selfRelay.ts' },
      { label: 'recipient.ts openRouterWindow (MsgOpenEVMWindow, allowed_targets = [router])', path: 'frontend/src/lib/recipient.ts' },
      { label: 'self-relay-v5.mjs (the live run below)', path: 'contracts-v4/script/self-relay-v5.mjs' },
      { label: 'PocketRouter.relay: no caller check, authority is the ML-DSA-87 signature inside the call', path: 'contracts-v4/src/PocketRouter.sol#L37-L42' },
      { label: 'renew-window.mjs (relayer fallback window)', path: 'backend/scripts/renew-window.mjs#L37-L39' },
    ],
    live: [
      { label: 'test account opens its own window, hybrid-signed, scoped to the v5 router only (400 blocks, 3 txs, expiry height 10,755,999): code 0, pqc_hybrid_verify verified', hash: 'A6C998D75F07A78F260EB64CC6AB597D30A842599265D5D8627F514E5ED663FD' },
      { label: 'the same account submits its own claim through router.relay (0.2 QOR into its Pocket)', hash: '0xb7941d40569f7e45217980137a3120c7690bdb0c4aa17e9d2df150c718fd2663' },
      { label: 'the same account submits its own first spend through router.deployAndRelay (deploys its Pocket, 0.05 QOR)', hash: '0x3abed0a3672504bf026a2e104e03ce917c4c2ddcfe2735430096d92ea88403b6' },
      { label: 'it closes its window: code 0', hash: '3DAFE5B728E8630EF8FE5BB8284F0743BDB3166F6CB8A1A40AAF0F7DE82D8CD5' },
      { label: 'relayer tx to the drop contract directly: refused by the chain at broadcast (not an allowed recipient)', note: 'refused before inclusion, so there is no hash; see contracts-v4/LIVE_RESULTS.md' },
    ],
    tests: ['frontend test/selfRelay.test.ts (calldata, window reuse only when router-only, fallback rules, the recorded run)', 'reverify.mjs section 11 (window scope, submitter = the user, window closed now)', 'backend test/misc.test.ts "health" and "windowWarning"', 'test_relay_refuses_non_pocket_targets'],
  },
  {
    id: 'smart-account',
    requirement: 'Smart account with spending rules: daily limit, 24 h timelock above it, owner veto',
    code: [
      { label: 'PocketVault.spend / executeQueued / vetoQueued', path: 'contracts-v4/src/PocketVault.sol#L243-L280' },
    ],
    live: [
      { label: '2.5 QOR spend above the 2 QOR limit: queued, not paid', hash: '0x93c9d7434943adf2993be31a87bc6fac1ad11b123f87a9fe226fc6998930b1fc' },
      { label: 'executed before the timelock: reverted TooEarly', hash: '0x48ab50d8946248abd715a727727e90b266a6534931f0216b1d3a8c2305288e68' },
      { label: 'owner vetoes the queued spend', hash: '0xf40199c3ae67bfd2b4503a390bd4225a1356c09fbd7065d0ce5ab3a7800e2b20' },
    ],
    tests: ['test_spend_above_remaining_allowance_queues_with_timelock', 'test_big_spend_executes_only_after_timelock_and_once', 'test_owner_vetoes_queued_spend'],
  },
  {
    id: 'stolen-key',
    requirement: 'A stolen owner key: guardians freeze the Pocket, all guardians move it to a new key, the old key dies',
    code: [
      { label: 'PocketVault.guardianFreeze', path: 'contracts-v4/src/PocketVault.sol#L456' },
      { label: 'proposeRecoveryUnanimous / finalizeRecoveryUnanimous', path: 'contracts-v4/src/PocketVault.sol#L402-L430' },
    ],
    live: [
      { label: 'guardian freeze (2 of 3)', hash: '0xa0042ee4b44a67f65342c8f99aa117229af5d24ca38301dd03b32261b49956cf' },
      { label: 'thief spend while frozen: reverted Frozen', hash: '0xd4ca2455271a6a0a2f16862632dda34da026789985089753ecab209fdd86f416' },
      { label: 'unanimous recovery finalized, owner replaced', hash: '0x97aa69e5597e70fcccd49ad012f85b4ab8bf29ff010317186c5c99135ee05494' },
      { label: 'old key spends after recovery: reverted BadSignature', hash: '0x3aee0b0293126ddb74e2698b733ee83edbb2f9f5881327275fc8837f3af54f4c' },
    ],
    tests: ['test_stolen_key_scenario_end_to_end', 'test_unanimous_recovery_old_key_cannot_veto', 'test_owner_key_cannot_lift_a_freeze', 'test_threshold_recovery_needs_a_proven_new_key_at_proposal_and_finalization', 'test_unanimous_recovery_needs_a_proven_new_key_at_proposal_and_finalization', 'e2e v4.spec.ts "d. Guardian freeze on a LAB Pocket"'],
  },
  {
    id: 'link',
    requirement: 'Sending by link: the link key (ML-DSA-87) binds the recipient, so a mempool thief cannot swap it',
    code: [
      { label: 'PocketDrop.bind', path: 'contracts-v4/src/PocketDrop.sol#L184' },
      { label: 'DropPool.claim', path: 'contracts-v4/src/DropPool.sol#L106' },
    ],
    live: [
      { label: 'thief swaps the recipient in a signed bind: reverted BadLinkSignature', hash: '0xf72a9a098d5ea3708302968a6caa712b04e3982870d2c7e34e37c28381996318' },
      { label: 'claim lands in the recipient Pocket', hash: '0x94d872a4b94ed9307bd29933161027891ca48e5b6d81602b0028a6b9c038a275' },
    ],
    tests: ['test_bind_rejects', 'test_digests_commit_to_everything', 'test_full_journey_sender_pocket_to_recipient_pocket_through_the_router', 'invariant_every_live_link_can_be_unwound_after_expiry (V4.invariant.t.sol)', 'invariant_a_link_pays_at_most_once (V4.invariant.t.sol)'],
  },
  {
    id: 'qorex',
    requirement: 'QoreX: a QoreX wallet signature spends a Pocket (TEAM-RUN), and the app can fund a Pocket from QoreX',
    code: [
      { label: 'QoreX connect and fund (signAndBroadcast)', path: 'frontend/src/lib/qorex.ts#L65-L114' },
      { label: 'official @qorechain/qorex-types: provider types, testnet ids, capability and chain-error checks', path: 'frontend/test/qorex.test.ts' },
      { label: 'evidence: signArbitrary response relayed as the owner signature', path: 'frontend/evidence/v4/e2e/qorex-wallet-intent-2026-11-20.json' },
    ],
    live: [
      { label: 'QoreX-signed intent mined through the production router', hash: '0xf98daf5ec7aecb3b82666c25ce10704f251e54460e066a6bc3733a6635286d1a' },
    ],
    tests: ['reverify.mjs check 7 (QoreX intent mined with status 1)'],
  },
  {
    id: 'qcai',
    requirement: 'Four-stage QCAI audit (v4 Stages 1–2, v5 Stage 3, v5.1 Stage 4), every finding answered',
    code: [
      { label: 'docs/AUDIT.md (finding -> resolution -> test)', path: 'docs/AUDIT.md' },
      { label: 'Stage 1 PDF (19 Nov, v4)', path: 'docs/audit/stage1/QCAI-stage1-2026-11-19.pdf' },
      { label: 'Stage 2 PDF (20 Nov, v4)', path: 'docs/audit/stage2/QCAI-stage2-2026-11-20.pdf' },
      { label: 'Stage 3 PDF (26 Nov Cairo, v5)', path: 'docs/audit/stage3/QCAI-stage3-v5.pdf' },
      { label: 'Stage 3 JSON (26 Nov Cairo, v5)', path: 'docs/audit/stage3/qcai-stage3-v5.json' },
      { label: 'Stage 4 PDF (26 Nov Cairo, v5.1)', path: 'docs/audit/stage4/QCAI-stage4-v5.1.pdf' },
      { label: 'Stage 4 triage (v5.1: verdict and test per finding)', path: 'docs/audit/stage4/QCAI_V5_1_TRIAGE.md' },
      { label: 'Stage 4 evidence tests', path: 'contracts-v4/test/QcaiV51AuditRegression.t.sol' },
      { label: 'v5.2: each Stage 4 item answered in code (deployed 26 Nov)', path: 'docs/audit/stage4/V5_2_CHANGES.md' },
      { label: 'Stage 5 source (v5.2 flattened, SHA-256 in SHA256SUMS)', path: 'docs/audit/stage5/PocketDrop-v5.2-flattened.sol' },
      { label: 'v5.2 tests', path: 'contracts-v4/test/V52Hardening.t.sol' },
    ],
    live: [{ label: 'Stage 1 QCAIA-1795130931306-3D8DAA40 (82), Stage 2 QCAIA-1795138339351-F6A93427 (78), Stage 3 QCAIA-1795645590445-DF0CEDA6 (85), Stage 4 QCAIA-1795655356279-BA1C1020 (82, 0 critical, v5.1)', note: 'https://dashboard.qorechain.io/audits/QCAIA-1795655356279-BA1C1020' }],
    tests: ['each finding names its regression tests in docs/AUDIT.md', 'testFuzz_qcai51_h1_finalize_outcome_is_independent_of_caller', 'testFuzz_qcai51_m2_drip_sum_never_wraps_at_extreme_bounds', 'test_qcai51_m3_reentry_into_every_entry_point_is_refused', 'test_qcai51_l4_six_guardians_rejected_at_deploy', 'test_v52_finalize_by_unrelated_account_is_not_authorized', 'test_v52_finalize_unanimous_rejects_the_old_owner_and_accepts_guardian_or_new_owner'],
  },
  {
    id: 'tests',
    requirement: 'Foundry tests, CI on every push, one-command re-verification',
    code: [
      { label: 'contracts-v4/test', path: 'contracts-v4/test' },
      { label: 'ci.yml', path: '.github/workflows/ci.yml' },
      { label: 'reverify.mjs', path: 'frontend/scripts/reverify.mjs' },
    ],
    live: [{ label: 'CI runs on GitHub Actions', note: 'see the Actions tab of the repository' }],
    tests: ['forge test (178, 100% line and branch coverage of src/)', 'node frontend/scripts/reverify.mjs'],
  },
  {
    id: 'qoreseal',
    requirement: 'QoreSeal: an ML-KEM-1024 encryption key registered on chain (MsgRegisterKEMKey, hybrid-signed) from a listed project account, read back and used to seal and open a note',
    code: [
      { label: 'qoreseal-key.mjs (register, read back, seal, open, refuse a wrong key)', path: 'tools/qoreseal-key.mjs' },
      { label: 'evidence (LIVE check output)', path: 'frontend/evidence/v4/qoreseal/deployer-kem.json' },
    ],
    live: [
      { label: 'deployer registers its ML-KEM-1024 key: code 0, pqc_hybrid_verify=verified, pqc_kem_key_registered', note: 'Cosmos tx D53D4B3B3568AEF0437295333A9E88F8EC50AEF608FE2EBF358FBAE5BD76191B at height 10625147; reverify.mjs section 10 also reads the key back from /qorechain/pqc/v1/kem' },
    ],
    tests: ['reverify.mjs section 10 (tx code, sender, hybrid status, on-chain key = recorded sha256)', 'qoreseal-key.mjs check (own key opens, random key: NOT_A_RECIPIENT, wrong purpose: DECRYPTION_FAILED)'],
  },
  {
    id: 'relayer-refill',
    requirement: 'The relayer cannot quietly run dry: a capped auto-refill job, shown on /api/health',
    code: [
      { label: 'refill.ts (plan, 24 h cap read from the chain)', path: 'backend/src/refill.ts' },
      { label: 'refill-relayer.yml (every 3 h)', path: '.github/workflows/refill-relayer.yml' },
    ],
    live: [
      { label: 'first refill: 0.8 QOR to the relayer, hybrid-signed MsgSend', note: 'Cosmos tx 2C3D0A59D299C953A94EC68280CA6C6FCC11424A8580765C5C4905D0DFED87C8; /api/health relayer.refill shows the last refill' },
    ],
    liveHealth: true,
    tests: ['backend test/refill.test.ts (caps, reserve, 24 h sum, health block)'],
  },
  {
    id: 'real-crypto-tests',
    requirement: 'Foundry tests with real ML-DSA-87 signatures (not a mock verifier), and the same tests against the live Diana precompile',
    code: [
      { label: 'RealCrypto.t.sol (26 tests)', path: 'contracts-v4/test-real/RealCrypto.t.sol' },
      { label: 'mldsa.mjs (two independent ML-DSA-87 implementations must agree)', path: 'contracts-v4/script/ffi/mldsa.mjs' },
      { label: 'LiveDiana.t.sol (live profile, 31 tests)', path: 'contracts-v4/test-live/LiveDiana.t.sol' },
      { label: 'mutation-check.sh (accept-all verifier must fail the suite)', path: 'contracts-v4/script/ffi/mutation-check.sh' },
    ],
    live: [
      { label: 'live profile: pqcVerify answered by the Diana precompile through eth_call (no transaction)', note: 'FOUNDRY_PROFILE=live forge test, CI job contracts-live' },
      { label: 'accept-all mutation: 19 of 26 real-crypto tests fail, as they must', note: 'CI job contracts-realcrypto' },
    ],
    tests: ['test-real: test_spend_one_flipped_signature_bit_refused', 'test-real: test_spend_truncated_oversized_and_empty_signature_refused', 'test-real: test_owner_key_rotated_in_registry_old_and_new_key_both_refused', 'test-real: test_drop_open_mode_full_flow_real_signatures', 'test-real: test_pool_claim_real_signatures_and_domain_separation', 'test-live: test_live_verify_real_signature_through_pqclib', 'test-live: test_fork_of_diana_has_no_precompile_code_and_pqclib_fails_closed'],
  },
  {
    id: 'precompile-conformance',
    requirement: 'The two precompiles measured against FIPS 204: 43 eth_call cases, 0 anomalies, and PqcLib kept consistent with the recorded answers',
    code: [
      { label: 'probe-precompiles.mjs', path: 'contracts-v4/script/probe-precompiles.mjs' },
      { label: 'PRECOMPILE_CONFORMANCE.md (findings)', path: 'docs/PRECOMPILE_CONFORMANCE.md' },
      { label: 'recorded answers (JSON)', path: 'docs/precompile-conformance.json' },
    ],
    live: [
      { label: 'recorded 25 Nov 2026 19:49 UTC: wrong sizes, ML-DSA-65 / 44, context and internal-API signatures return false; key-status offset always 0x80; empty message refused at block 10,654,799, accepted from 10,654,800', note: 'eth_call only, no transaction' },
    ],
    tests: ['test_pqcLib_verify_matches_fips204_on_every_recorded_live_answer', 'test_pqcLib_keyStatus_decodes_every_recorded_live_answer', 'test_recorded_key_answers_have_the_layout_the_strict_v5_lib_requires'],
  },
  {
    id: 'v5-strict-pqclib',
    requirement: 'v5: PqcLib requires exact ML-DSA-87 sizes (2,592-byte keys, 4,627-byte signatures) and the exact key-status layout; deployed and smoke-tested on Diana',
    code: [
      { label: 'PqcLib.verify (sizes before the precompile)', path: 'contracts-v4/src/PqcLib.sol#L44-L54' },
      { label: 'PqcLib.checkKey (BadKeyLength)', path: 'contracts-v4/src/PqcLib.sol#L148-L169' },
      { label: 'docs/V5.md (changes, gas, cost)', path: 'docs/V5.md' },
      { label: 'smoke-v5.mjs', path: 'contracts-v4/script/smoke-v5.mjs' },
    ],
    live: [
      { label: 'v5 prod router deployed at block 10,746,808', note: 'deploy tx 0x72cd976af4effc18cc04fc09e3487688516912d51ebc8689b2bde0b776bb8393, re-checked with the code hash of every v5 contract by reverify.mjs' },
      { label: 'v5 Pocket lazily deployed and an Open drop created by ML-DSA-87 intent', hash: '0xd098f67aeebce5e013c65639a3d492343181ea72ac6905c700746689c96980ea' },
      { label: 'drop claimed by a newcomer with its own registered key', hash: '0x08438baf17ecdb80692eb8ed8a393e222ef1cadd67727c91b82ec18263a87a1a' },
      { label: 'pool slot claimed (link-key and claimer signatures)', hash: '0x0c260ee46f71ab773de52868e6cb22ed8c90a91e10bc6e11be357a19064537ef' },
    ],
    tests: ['test_v5_verify_refuses_wrong_sizes_before_the_precompile', 'testFuzz_v5_verify_true_only_at_exact_sizes', 'test_v5_keyStatus_refuses_trailing_data', 'test_v5_keyStatus_refuses_gap_between_head_and_tail', 'test_v5_checkKey_refuses_ml_dsa_87_key_of_wrong_length', 'test-real: test_pocket_with_truncated_owner_key_cannot_be_created'],
  },
];
