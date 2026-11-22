# Pocket Drop

> **Testnet only.** Everything here runs on the QoreChain Diana testnet (EVM chain id 9800, Cosmos chain id `qorechain-diana`). The QOR involved has no monetary value.

Send QOR to a friend who has no wallet. They open a link, and their browser creates a **Pocket**: a smart account that only an ML-DSA-87 (FIPS 204) key can move. The money lands there. If the friend's classical key leaks, or a quantum computer recovers it, the money still cannot move: every spend needs a post-quantum signature that the chain checks through its `pqcVerify` and `pqcKeyStatus` precompiles.

- App: https://pocketdrop-app.vercel.app (nav: Send, Receive, Pocket, Proof)
- Relayer API: https://pocketdrop-api.vercel.app (`/api/health`, `/api/stats`, `/api/qday`)
- Video: _link added at submission_
- Track: Post-Quantum dApp. License: MIT.

## The story in four lines

1. On Q-Day, anyone who knows a classical (secp256k1) private key can sign as its owner. Today that means a leak; later it means a quantum computer.
2. Pocket Drop gives each user a Pocket whose owner is an ML-DSA-87 key registered on chain with proof of possession. The classical key only pays gas.
3. A sender funds a one-time link. The link key binds exactly one recipient. The recipient claims into their Pocket, and the claim is checked by both precompiles.
4. We publish the classical keys of five bait Pockets on `/qday` and attack them every hour. The money is still there.

## Judge path: 60 seconds

| Step | Open | What you should see |
|---|---|---|
| 1 | https://pocketdrop-app.vercel.app/qday | Five bait Pockets with their **classical keys published**, their balances (LIVE), the hourly attacker log and the alarm state. Our own drill: self-run and always on, and separate from the organisers' 18 Nov drill. |
| 2 | https://pocketdrop-app.vercel.app/receive | Take one slot of the team-hosted sample pool. A Pocket is created in your browser, and the QOR lands in it. No wallet needed. |
| 3 | The explorer link shown after the claim | The claim transaction on Diana, mined through our router. |
| 4 | https://pocketdrop-app.vercel.app/judges | Every track requirement, mapped to code, a live transaction and a test. |

## Numbers

Each number is labelled. **LIVE** means it is read from the chain or the API when you open the link. **RECORDED** means it comes from a file in this repo, written by a named script on the date shown.

| Number | Label | Source |
|---|---|---|
| 468 checks passed, 0 failed: 316 EVM and 95 Cosmos transactions re-checked against Diana (status, contract, decoded error, and for hybrid relays `pqc_hybrid_verify`) | RECORDED, 22 Nov 2026 | `node frontend/scripts/reverify.mjs` |
| 167 Foundry tests (unit, fuzz and invariant); 100% line, statement, branch and function coverage of `contracts-v4/src` | RECORDED | [`contracts-v4/COVERAGE.md`](contracts-v4/COVERAGE.md) |
| 130 frontend and 177 backend unit tests passed (9 backend tests skipped: they run only against a deployed API, with `PD_API_URL` set) | RECORDED, 22 Nov 2026 | [`frontend/src/data/tests.json`](frontend/src/data/tests.json), from `node frontend/scripts/count-tests.mjs` |
| 103 recorded live steps on the v4 contracts, 31 of them attacks that reverted on chain or were refused by the chain | RECORDED | [`contracts-v4/LIVE_RESULTS.md`](contracts-v4/LIVE_RESULTS.md), synced into `frontend/src/data/v4.json` |
| QCAI audit: Stage 1 scored 82, Stage 2 scored 78 (same 5 findings; 1 real and bounded, 4 false positives) | RECORDED | [`docs/AUDIT.md`](docs/AUDIT.md) |
| Bait Pocket balances, published-key status, attacker log, alarm | LIVE | `/qday`, `GET /api/qday` |
| Relay lane (`hybrid`: every relay a `MsgCrossVMCall` signed secp256k1 + ML-DSA-87), ECDSA-only path (closed), relayer balance, low-balance warning | LIVE | `/judges`, `/proof`, `GET /api/health` |
| Every attempt against the five bait Pockets that the chain refused (EVM reverts and failed hybrid relays) | LIVE | `/qday` "Refused attempts" |
| Drop counts and volume, split into team/test addresses and external addresses | LIVE | `/radar`, `GET /api/stats` |
| ML-DSA-87 signature size: 4,627 bytes | Constant (FIPS 204) | `backend/src/config.ts` |

## Check our claims

| Claim | How to check it yourself |
|---|---|
| A wrong post-quantum key cannot spend a Pocket | Tx [`0x312c0fe1…0dcb`](https://explore.qore.network/tx/0x312c0fe1ecfe1a0159618152ade48639139671adbda5336b4132d06f2a830dcb) reverted with `BadSignature`. Test `test_wrong_key_wrong_prefix_raw_digest_are_rejected`. |
| A replayed intent fails | Tx [`0x54d99c1e…7fec`](https://explore.qore.network/tx/0x54d99c1e8b04744df5a0360a5dd7b0a02b3066d7f39794a5af97f90ba6957fec) reverted. Test `test_replayed_intent_reverts`. |
| A claim needs a registered key with proof of possession | Tx [`0x4664a69a…5b5b`](https://explore.qore.network/tx/0x4664a69a207575641d38bcf3af724d9f81753c275dd8312c2a66fb3b18be5b5b) reverted with `PossessionNotProven`. Test `test_claim_key_requirements`. |
| A mempool thief cannot swap the recipient | Tx [`0xf72a9a09…6318`](https://explore.qore.network/tx/0xf72a9a098d5ea3708302968a6caa712b04e3982870d2c7e34e37c28381996318) reverted with `BadLinkSignature`. Test `test_bind_rejects`. |
| Guardians can freeze a Pocket whose key was stolen | Freeze [`0xa0042ee4…56cf`](https://explore.qore.network/tx/0xa0042ee4b44a67f65342c8f99aa117229af5d24ca38301dd03b32261b49956cf), then the thief's spend [`0xd4ca2455…f416`](https://explore.qore.network/tx/0xd4ca2455271a6a0a2f16862632dda34da026789985089753ecab209fdd86f416) reverted with `Frozen`. Test `test_stolen_key_scenario_end_to_end`. |
| Every relay carries a post-quantum signature, checked by the chain | `GET /api/health`: `relay.mode` is `hybrid` and `relay.classicalPathOpen` is `false`. Relay [`04AA1783…D445`](https://pocketdrop-app.vercel.app/check/04AA17839F57179DA8EC58454F1CD1CEBDDA4D883C86376B4CD92720AF56D445) is a `MsgCrossVMCall` with `pqc_hybrid_verify=verified`; the relayer's ECDSA-only EVM window is closed, so an ECDSA-only relay is refused at broadcast (`contracts-v4/LIVE_RESULTS.md`, "Hybrid relay lane"). |
| You can re-check a signature without trusting us | Open [`/check`](https://pocketdrop-app.vercel.app/check): it fetches a transaction from Diana and re-verifies its ML-DSA-87 signatures in your browser with `@qorechain/qoresign`, including a [refused Q-Day attack](https://pocketdrop-app.vercel.app/check/FB826A14E7E1A8A6271E9489E2BA12BF17075CC793479720F981594F758F00D3). |
| A QoreX wallet signature can spend a Pocket | Tx [`0xf98daf5e…6d1a`](https://explore.qore.network/tx/0xf98daf5ec7aecb3b82666c25ce10704f251e54460e066a6bc3733a6635286d1a) (TEAM-RUN), evidence in `frontend/evidence/v4/e2e/qorex-wallet-intent-2026-11-20.json`. |
| Every recorded hash is real | Run `cd frontend && npm ci && node scripts/reverify.mjs`. |

## How it works

- **Pocket** (`PocketVault`, cloned by `PocketFactory`). The owner is an address whose ML-DSA-87 key is registered with proof of possession; the key's hash is pinned at creation. Every owner action is an intent signed with that key over a QoreX-format message (`qorechain-msg-v1|qorechain-diana|0x<digest>`) that binds the chain, the Pocket, the action, the nonce and the deadline.
  - Spends are free up to a daily limit. Anything above it is queued behind a timelock and can be vetoed by the owner.
  - Guardians (up to 5) can freeze the Pocket, recover it by threshold (the owner can veto), or recover it unanimously (the old key cannot veto).
  - ERC-1271 `isValidSignature` exposes the same check to other contracts. `PqGuard` lets any dApp require a post-quantum approval.
- **PocketRouter** relays signed intents and can deploy a Pocket on first use. Funds sent to a Pocket's address before it exists are kept.
- **PocketDrop** (send by link) and **DropPool** (one link, many claimers). The link key binds one recipient (`pqcVerify`). The claim needs the recipient's registered, proven key (`pqcKeyStatus`) and a signature from it (`pqcVerify`).
- **Relayer** (`backend/`, Vercel functions) pays gas and forwards intents as hybrid-signed `MsgCrossVMCall`s (secp256k1 + ML-DSA-87, both checked by the chain before the EVM runs). It cannot forge any intent.

The full call-site list (what each `pqcVerify` and `pqcKeyStatus` call protects, with tests) is in [docs/AUDIT.md, section 5](docs/AUDIT.md#5-post-quantum-design-every-pqcverify-and-pqckeystatus-call-site).

## Contracts on Diana (v4)

From [`contracts-v4/deployments/diana.json`](contracts-v4/deployments/diana.json). PROD uses a 24 h timelock, 48 h recovery, 72 h freeze and 72 h unanimous recovery. LAB uses the same bytecode with short delays (60 s timelock and recovery, 120 s freeze, 180 s unanimous recovery), so the flows can be demonstrated in minutes.

| Contract | PROD | LAB |
|---|---|---|
| PocketRouter | `0xb0d8fd2379e06ed5d48371b41baa6dd0a31cf209` | `0x0b4ee3c8a7a63716c5700b2711ad57a461b7ac2d` |
| PocketFactory | `0x74b604e8f1bb729a6e43dcd893f01747688e3e8f` | `0x864cf0278a24c1b27d1ac66c883c3e74ff8d5a0c` |
| PocketVault (implementation) | `0x899b289ef60444ac74d82dea5cacc6637a2a29c3` | `0xd017f09992c4c0f27f2d504ba42fe7d3bf578d96` |
| PocketDrop | `0xbc13b9ee91f31ed56932abdb796693515c351f00` | `0x42da108a4e8bf5d152600b470f1abd28debdee59` |
| DropPool | `0xaa981588e5430e3db9a789a3754e108cc01e3d00` | `0x1858193617bc2f2e2570a137320e1a1cb3a7ce5b` |

- PqGuard example (`PqGuardedCounter`): `0x5ae81c71b7ff0c93886df8fe7502f3c846c3835f`
- Legacy v3 PocketDrop (still readable, used by old links): `0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97`
- Relayer: `0xF6e6fb2d33Bef3043682658E2b69F3a2F8616cCD` / `qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl`

Explorer: `https://explore.qore.network/tx/<hash>`. The contracts are frozen: no owner, admin, pause or upgrade.

## Trust model and custody

- **Users** hold their own keys. A browser user's ML-DSA-87 seed is generated independently of the secp256k1 key and stays in that browser. Users should back it up and add guardians. A QoreX wallet user signs with QoreX.
- **Relayer custody.** The relayer has two keys, and neither can move user funds:
  - its secp256k1 key (`RELAYER_SECP_KEY`), held by the API deployment, and its ML-DSA-87 seed (`RELAYER_PQC_SEED`), held by a separate signer deployment (`signer/`) that signs only policy-checked relays. One compromised environment does not give both keys; `/api/health` shows `relay.pqSigner: isolated`. Both are also GitHub Actions secrets for the manual `renew-window` workflow, and an unused seed copy in the API environment awaits removal.
  The relayer's EVM window is closed, so it has no ECDSA-only path. If an operator re-opens it by hand, it is scoped to the two v4 routers and the v3 drop, with transaction and value caps. Whoever holds both relayer keys can spend the relayer's gas float or delay and refuse service. They cannot forge an intent, a bind or a claim, and cannot move escrow or Pocket funds (`docs/THREAT_MODEL.md`, T14).
- **Precompiles.** `pqcVerify` (0x0A01) and `pqcKeyStatus` (0x0A02) are assumed correct. `PqcLib` fails closed on any failed call or malformed data, but it cannot detect a precompile that lies.
- **Links** are bearer secrets until bound: whoever holds an unbound link can choose the recipient. Confirmed mode adds a sender check of the recipient key fingerprint.

Threats, mitigations and residual risk: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). Known limits: [contracts-v4/KNOWN_ISSUES.md](contracts-v4/KNOWN_ISSUES.md).

## Audit

Two-stage QCAI audit: Stage 1 scored 82 (19 Nov 2026) and Stage 2 scored 78 (20 Nov 2026). Every finding is mapped to a resolution and tests, the lower Stage 2 score is explained, and the deployed bytecode is identical to the Stage 2 source. Details: [docs/AUDIT.md](docs/AUDIT.md). PDFs: [`docs/audit/`](docs/audit/).

## Run it

```bash
cd contracts-v4 && forge test                  # 167 tests
cd backend && npm ci && npm test               # relayer unit tests
cd frontend && npm ci && npm test              # app unit tests
cd frontend && node scripts/reverify.mjs       # re-check every recorded hash on Diana
```

## Repository map

| Path | What |
|---|---|
| [`contracts-v4/`](contracts-v4/) | v4 contracts, Foundry tests, deploy scripts, [LIVE_RESULTS.md](contracts-v4/LIVE_RESULTS.md), [KNOWN_ISSUES.md](contracts-v4/KNOWN_ISSUES.md), [SECURITY.md](contracts-v4/SECURITY.md) |
| [`backend/`](backend/) | Relayer API (bind, claim, route, sponsor, stats, health, qday) |
| [`frontend/`](frontend/) | Web app, e2e and QA specs, evidence, re-verification scripts |
| [`docs/`](docs/) | [AUDIT.md](docs/AUDIT.md), [THREAT_MODEL.md](docs/THREAT_MODEL.md), [qday/FEASIBILITY.md](docs/qday/FEASIBILITY.md), [cbom/](docs/cbom/README.md) |
| [`contracts/`](contracts/) | Legacy v3 PocketDrop contract and its results |
| [`AI_USAGE.md`](AI_USAGE.md), [`llms.txt`](llms.txt) | How AI assistance was used; a plain-text map of the repo |

## Credits

| Used for | Package or service | License |
|---|---|---|
| QoreChain kit: accounts, transactions, PQC key registration | `@qorechain/sdk` | Apache-2.0 |
| QoreChain kit: ML-DSA-87 keys, signing, proof of possession | `@qorechain/pqc` | Apache-2.0 |
| QoreChain kit: EVM helpers | `@qorechain/evm` | Apache-2.0 |
| QoreChain kit: QoreX message format and ML-DSA-87 verification in the browser (`/check`) | `@qorechain/qoresign` | Apache-2.0 |
| Cryptographic bill of materials ([docs/cbom](docs/cbom/README.md)) | QoreScan Community | QoreChain tool |
| Wallet connection and signing | QoreX wallet | QoreChain product |
| Network and precompiles | QoreChain Diana testnet, `pqcVerify` / `pqcKeyStatus`, hybrid `MsgCrossVMCall`, scoped EVM window (closed) | QoreChain network |
| Contract audit | QCAI (QoreChain AI audit) | QoreChain service |
| Cosmos transactions | `@cosmjs/stargate`, `cosmjs-types` | Apache-2.0 |
| EVM client, ABI encoding | `viem` | MIT |
| Contract tests | Foundry, `forge-std` | MIT or Apache-2.0 |
| UI | `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `framer-motion`, `three`, `tailwindcss`, `@phosphor-icons/core` | MIT |
| Data validation | `zod` | MIT |
| Encoding, QR codes | `@scure/base`, `qrcode` | MIT |
| Build and test | `vite`, `vitest`, `esbuild`, `eslint` (MIT); `typescript`, `@playwright/test` (Apache-2.0) | as listed |
| Hosting | Vercel (`@vercel/node`) | Apache-2.0 |
| Fonts | Funnel Sans, Funnel Display, Instrument Serif, DM Mono (Google Fonts) | SIL OFL 1.1 |
| Word list for key fingerprints | BIP-39 English list, as shipped in `viem/accounts` | MIT |

## License

MIT, see [LICENSE](LICENSE).
