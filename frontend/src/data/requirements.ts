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
      { label: 'PqcLib.verify', path: 'contracts-v4/src/PqcLib.sol#L37-L40' },
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
      { label: 'PqcLib.keyStatus / requireKey', path: 'contracts-v4/src/PqcLib.sol#L51-L54' },
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
    requirement: 'Scoped EVM window (the fallback, closed while relays are hybrid): when open, the relayer can only call the two routers (and the v3 drop), with tx and value caps',
    code: [
      { label: 'renew-window.mjs (hybrid-signed MsgOpenEVMWindow, allowed_targets)', path: 'backend/scripts/renew-window.mjs#L37-L39' },
      { label: 'renew-window.yml (every 2 h)', path: '.github/workflows/renew-window.yml' },
    ],
    live: [
      { label: 'relayer tx to the drop contract directly: refused by the chain at broadcast (not an allowed recipient)', note: 'refused before inclusion, so there is no hash; see contracts-v4/LIVE_RESULTS.md' },
    ],
    tests: ['backend test/misc.test.ts "health" and "windowWarning"', 'test_relay_refuses_non_pocket_targets'],
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
    requirement: 'Two-stage QCAI audit, every finding answered',
    code: [
      { label: 'docs/AUDIT.md (finding -> resolution -> test)', path: 'docs/AUDIT.md' },
      { label: 'Stage 1 PDF (19 Nov)', path: 'docs/audit/stage1/QCAI-stage1-2026-11-19.pdf' },
      { label: 'Stage 2 PDF (20 Nov)', path: 'docs/audit/stage2/QCAI-stage2-2026-11-20.pdf' },
    ],
    live: [{ label: 'public reports QCAIA-1795130931306-3D8DAA40 (82) and QCAIA-1795138339351-F6A93427 (78)', note: 'links in docs/AUDIT.md' }],
    tests: ['each finding names its regression tests in docs/AUDIT.md'],
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
];
