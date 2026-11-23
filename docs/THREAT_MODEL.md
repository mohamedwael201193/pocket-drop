# Pocket Drop threat model (v4, Diana testnet)

Status: 22 Nov 2026 (relayer moved to the hybrid lane, EVM window closed). Scope: PocketDrop v4, DropPool, PocketVault / PocketFactory / PocketRouter (contracts-v4, frozen), the relayer API, the browser app. Testnet only: nothing here holds real value.
Related: [contracts-v4/KNOWN_ISSUES.md](../contracts-v4/KNOWN_ISSUES.md), [contracts-v4/SECURITY.md](../contracts-v4/SECURITY.md), [docs/AUDIT.md](AUDIT.md), [live results](../contracts-v4/LIVE_RESULTS.md).

## 1. What we protect
| Asset | Where | Who must be able to move it |
|---|---|---|
| Escrowed drop amounts | PocketDrop v4 | the bound recipient (ML-DSA claim) or the sender after expiry |
| Pool funds | DropPool | claimers with a valid link proof + ML-DSA key, the host after close |
| Pocket balances | PocketVault clones | the owner's ML-DSA-87 key only (daily limit, timelock above it); guardians can freeze and, unanimously, recover |
| The user's keys | QoreX wallet, or the browser (`localStorage`) | the user |
| Relayer gas float | relayer account `0xF6e6…6cCD` | the relayer |

## 2. Adversaries
- **Q-Day attacker**: knows a victim's secp256k1 private key (leak today, or recovered from a public key by a quantum computer). The core case.
- Link interceptor: reads a claim URL (chat preview, shoulder, forwarded message).
- Malicious or compromised relayer.
- Malicious guardian(s).
- Web attacker: XSS or a malicious script on the app origin, a malicious browser extension.
- Grief/DoS: spams the relayer, the sponsor, or the pool.

## 3. Trust assumptions
1. QoreChain's `pqcVerify` (0x…0a01) and `pqcKeyStatus` (0x…0a02) precompiles are correct, and PoP registration proves possession of the ML-DSA key.
2. ML-DSA-87 is not broken.
3. A user's ML-DSA secret is **independent** of their secp256k1 key (see T3: this was false for browser keys until 20 Nov 2026).
4. The relayer is liveness-only: it can delay or censor, never forge.
5. Since 22 Nov 2026 the relayer signs every relay as a native `MsgCrossVMCall` with secp256k1 + ML-DSA-87, and the chain checks both (`pqc_hybrid_verify`). Its EVM window is closed, so its classical key alone cannot send.

## 4. Threats and mitigations
| # | Threat | Mitigation | Evidence | Residual |
|---|---|---|---|---|
| T1 | Q-Day attacker spends from a Pocket with the classical key | every Pocket action is an ML-DSA intent checked via pqcVerify + PoP + pinned key hash | FEASIBILITY E1–E10: all refused on chain (`BadSignature`) | none known |
| T2 | Q-Day attacker changes guardians / limit / recovery | same `_auth`; recovery needs guardian ML-DSA signatures and a delay; owner veto | E3, E4, E7 refused | malicious guardian majority, see T7 |
| **T3** | **Browser key: ML-DSA secret derived from the secp key** (legacy roots: `pqcSecret = sha256(root‖"|mldsa87")`, root = secp key) | **FIXED** in `43cc149` + `28e1755`: new roots are `pd2:<master>`; secp = `sha256("pocketdrop/key/v2/secp256k1"‖master‖ctr)`, ML-DSA = `sha256("pocketdrop/key/v2/mldsa87"‖master)`; neither leaf reveals the other. Legacy roots still load, and get a red "not quantum-safe, move your funds" banner with a one-tap move to a fresh v2 key and Pocket | flaw exploited live on test account W (`0x445b5443…8893`); v2 proven live: drop p21, recipient key registered with PoP and claimed (§6); unit tests `frontend/test/keyderive.test.ts` | legacy Pockets until their owners press Move; amounts above the daily limit need a second move next day |
| T4 | Interceptor claims a Confirmed drop | recipient binds with link key, sender confirms 4-word fingerprint, claim needs recipient ML-DSA | LIVE ATTACK 1 bind swap reverted | Giveaway mode is first-come by design |
| T5 | Replay of an intent | per-Pocket nonce + chain id + contract address in the digest | replay `0x54d9…` reverted | none |
| T6 | Relayer forges or redirects | relayer only submits signed intents; digest binds target and payTo | tests + live | censorship / delay |
| T7 | Guardians collude | threshold recovery has a delay and owner veto; unanimous recovery needs all guardians | KNOWN_ISSUES §3 | a full guardian set can take the Pocket (deliberate) |
| T8 | Early execution of a queued spend | timelock | `0x48ab…` reverted | none |
| T9 | Double pool claim | per-key and per-link claimed flags | `0xbd41…` reverted | sybil keys limited by link proofs |
| **T10** | **Live EVM window lets the classical key alone send** (FEASIBILITY O2) | opening a window needs the hybrid signature, so a Q-Day attacker cannot open one. **No browser flow opens a window** (since `43cc149`; the v3 claim's window step was removed). All browser actions go through the relayer as ML-DSA intents | O1–O4; code: `frontend/src/lib/recipient.ts` has no window code; `grep -r openEvmWindow frontend/src` is empty | QoreX users who open a window themselves. **The relayer's own window is closed** (22 Nov 2026: replaced by a 10-block window, `0373ACC4…C3A6`, which expired at height 10529379; an ECDSA-only relay from the relayer was then refused by the chain at broadcast, "EVM authorisation window exhausted", attempted hash `0xf2dbd9f5…d540`, see LIVE_RESULTS). Re-opening it needs the hybrid signature (operator workflow, manual only) |
| T11 | Draining the relayer's gas float (a hybrid relay costs about 0.10 to 0.17 QOR of native gas, more than the 0.08 of an EVM relay) | every relay is simulated first and never sent if it would revert; gas = dry run + 15%; per-IP and daily API caps; `/api/health` flags a balance under 3 QOR | `backend/test/hybrid.test.ts`, `/api/health` | a determined spammer can spend the float down to the daily cap; the bind relayer fee (0.06 QOR) does not cover a hybrid relay |
| T12 | XSS / malicious script or a storage scraper reads the browser root | React escaping, no `dangerouslySetInnerHTML`; **strict CSP** (`script-src 'self' 'wasm-unsafe-eval'`, no inline script or style, `connect-src` = self, `evm-testnet.qore.host`, `pocketdrop-api.vercel.app` only, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`), X-Frame-Options DENY, Permissions-Policy, HSTS, nosniff, no-referrer; **the root is sealed at rest** with a non-extractable AES-256-GCM key kept in IndexedDB (`frontend/src/lib/vault.ts`), plaintext pd2 and legacy roots migrate on load | `e2e/qa/security.spec.ts` (headers + no CSP violation on 15 routes + sealed-key check), `test/vault.test.ts` | the seal stops storage scraping (disk images, backups, profile sync, tools that read localStorage files); it does **not** stop code running in this origin, which can still ask the browser to decrypt. A new key is written in plaintext for a few milliseconds before it is sealed, so a closed tab never loses it. If IndexedDB is unavailable (some private modes) the root stays in plaintext. Extensions with page access are out of reach of any web defence |
| T13 | Lost browser storage | backup card (pd2: key), guardians | UI | users who never back up and never add guardians lose funds |
| T14 | Relayer key leak (secp256k1 in the API project; ML-DSA-87 seed in the isolated `pocketdrop-pqsigner` project since 22 Nov 2026; both also GitHub secrets for the manual window workflow) | the relayer holds no user funds and every relay carries the user's own ML-DSA intent; the PQ signer signs only policy-checked relays (one allowlisted `MsgCrossVMCall`, fee and gas caps, 600 an hour, HMAC); small float; health alarm on low balance; the window stays closed and its renewal is manual | `backend/test/pqSplit.test.ts`, `backend/test/pqSigner.test.ts`, `frontend/evidence/v4/e2e/hybrid-relay-isolated-signer.json`, KNOWN_ISSUES §2 | an API compromise can still obtain PQ signatures for allowlisted relays (gas float spend, censoring); a signer compromise alone gives nothing; the unused seed copy in the API env awaits owner-approved removal; never move escrow or Pocket funds |
| T15 | Sponsor abuse | link proof / funded Pocket proof, per-IP, per-link and daily caps, kill switch | backend sponsor tests | sponsor float can be drained to its daily cap |
| T16 | Stale cached app serves old (legacy) derivation | Vercel immutable assets + fresh index; one-time reload on a missing chunk | live bundle contains `pocketdrop/key/v2` | none known |
| T17 | Key rotation of an owner account | Pocket pins the key hash; rotation requires guardian recovery | KNOWN_ISSUES §4 | deliberate trade-off |
| T18 | Wrong network | chain id 9800 checks in app and scripts | `reverify.mjs` | testnet only |

## 5. Open items
- Done 20 Nov 2026: CSP + `frame-ancestors 'none'` and the sealed root (T12). Residual: same-origin code can still use the key.
- If IndexedDB is wiped but localStorage is kept, a sealed root cannot be opened; the app keeps the ciphertext aside under `<key>.undecryptable` and never overwrites it silently. The backup card (pd2: key) is the recovery path.
- Proof of a mined QoreX `signArbitrary` intent (KNOWN_ISSUES §5).
- The relayer's ML-DSA half is signed by a separate function with its own environment and a relay policy (T14). The unused seed copy was removed from the API env on 22 Nov 2026 and the API redeployed. Left: move the window workflow's secrets out of GitHub; an HSM would go further.
- The /qday refused-attempts list finds hybrid-lane attempts by fee payer, so it sees every attempt our relayer sent (the Try it button and the team bot). A failed cross-VM call that someone pays for themselves leaves no crossvm_request event and no EVM tx, so it is not listed; a successful one still raises the alarm through the bait balance and key checks.
- Contract-level size checks (23 Nov 2026 audit pass). `PqcLib` does not itself require a 4,627-byte signature or a 2,592-byte key, and it accepts a non-canonical key-status offset above 0x80 (`offset-0xa0-with-gap`, `ml-dsa-key-2591-bytes` in the shared vectors). Not exploitable as far as we can tell: the precompile verifies the signature, the owner key hash is pinned, and the Diana precompile returns the canonical layout (RECORDED). Adding the checks means a redeploy and a new two-stage QCAI run, so it is listed here instead; the API enforces the sizes before relaying.

## 6. Live proof of the fix (20 Nov 2026, team-run test accounts, not users)
Run `frontend/evidence/v4/e2e/v2-key-claim-proof.json` (Playwright `e2e/v4.spec.ts` "b. Giveaway", the recipient browser creates its key in the app). The test asserts the stored root is `pd2:`, the bound recipient address equals the v2 secp key's address, and the bound `recipientKeyHash` equals keccak of the ML-DSA key from the independent v2 secret.
| Step | Tx |
|---|---|
| sender Pocket createDrop (drop p21, 0.1 QOR, Giveaway) | `0x0a2381a827130c892170926b852953ff467f9c602df8affb2eb10414ebea16e4` |
| recipient bind (link-key signature, relayed) | `0x7fc540b628c1b1b4d5d16664ae95c62321d8f8dfd2be5384f47b056e898b3097` |
| recipient ML-DSA-87 key registration with PoP (Cosmos) | `C9D5DA3F629AAE77D3AD83A43D81887E4B442D76CA809D7D7FA4A8BF998548B9` |
| recipient claim (ML-DSA signature, relayed) | `0xa014e5afccb4cd6c1831a67461c56c1673b78f11bcc1aab55eb5ae96f993be5f` |
| sweep sender Pocket back to the deployer | `0x8350bc12def1379482e32af7773aeb944b0425e2dde87b63a821e29651898ffe` |
Chain read afterwards: `getLink(21)` state 4 (Claimed), recipient `0x1ED2DD17F128F7b995c0DAC461Ea11379700d66E`, payTo Pocket `0xA5627D7B6Fc54b9D07E1085bF2127B1D15797980` holds 0.1 QOR; `pqcKeyStatus(recipient)` = registered, algo 1 (ML-DSA-87), 2,592-byte key, possessionProven true.

## 7. Q-Day drill: "Steal this Pocket" (`/qday`, 20 Nov 2026, team-run baits)
Five TEAM-RUN bait Pockets on the prod instance (B1 plain, B2 guarded 2-of-2, B3 with a queued spend, B4 the bound recipient of a Confirmed drop, B5 counterfactual), each holding 0.2 QOR. Their **classical secp256k1 keys are public** (owner-approved; served by `/api/qday` only when `QDAY_PUBLISH_KEYS=true`, and the API refuses to serve any key that does not belong to a bait key account). Each bait's ML-DSA-87 secret is independent random entropy, never derived from the classical key (the fixed derivation). Anyone can run every classical-key path in the browser (eth_call) or with `contracts-v4/script/qday/attack.mjs` (CometBFT check_tx + eth_call), and put a Pocket attempt on chain through the relayer (rate-limited; the relayer simulates first and never mines a call that would succeed).
- Breach alarm (`/api/qday`): fires when a registered PQ key changes, an EVM window opens on a bait key account, a Pocket balance drops below what the team left, an unplanned vault event appears, or a non-team transaction against a bait succeeds (receipt status, not just the event attribute).
- Residual (T10): while an owner keeps an EVM window open, the classical key alone can send EVM transactions from the key account. Bait windows stay closed; opening one needs the hybrid signature, which a Q-Day attacker cannot make.
- The relayer-refused column is kept in memory per serverless instance (no database); on-chain columns are rebuilt from the chain every time.
- The team bot (`.github/workflows/qday-bot.yml`, hourly, labelled ours) runs every path read-only and mines one attempt every 6 h with the input marker `QDAYBOT1`; Try-it attempts carry `QDAYTRY1`.

## 8. Hardening pass (23 Nov 2026): precompile hygiene, signing format, escrow liveness, metrics
No contract was changed or redeployed; everything below is tests, API and app code.
- **Precompile return data.** `PqcLib.keyStatus` rejects non-0/1 booleans, an algorithm id above uint8, offsets that are below 0x80, unaligned or out of the buffer, and a key length past the buffer (fail closed, never a revert). The browser checker and the API use a stricter decoder (`frontend/src/lib/keystatus.ts`, byte-identical copy in `backend/src/keystatus.ts`) that also requires offset exactly 0x80, a 2,592-byte ML-DSA-87 key, zero padding and no trailing bytes. Both run on the same 18 vectors (`contracts-v4/test/fixtures/keystatus/vectors.json`), two of them RECORDED raw returns of the Diana precompile at block 10,624,498.
- **Sizes in production code.** `POST /api/route` decodes every relayed vault, drop and pool call and answers 400 `BadPqLength` before simulating when a signature is not 4,627 bytes or a link key is not 2,592 bytes (`backend/src/pqPreflight.ts`; its ABI is checked against `contracts-v4/abi`). On chain the sizes are enforced by the pqcVerify precompile and by the pinned key hash, not by a length check in `PqcLib` (see section 5, last item).
- **Key re-read on every authorization.** Each owner intent calls `pqcKeyStatus` again: withdrawn possession proof, another algorithm, an unregistered key, a rotated registry key (pinned hash) or a missing precompile all refuse the intent without consuming the nonce (`contracts-v4/test/Hardening.t.sol`).
- **New owner key.** Threshold and unanimous recovery require the new key to be registered with proof of possession at proposal and again at finalization (`Hardening.t.sol`).
- **Signing format.** All 596 well-formed fixture signatures are reproduced byte for byte by `@qorechain/qoresign` and the app's own signer, over bytes that both libraries build identically (`frontend/test/qoresign.diff.test.ts`). The signed text is a digest; `frontend/src/lib/clearsign.ts` turns each owner intent back into readable lines (recipient, amount, contract, chain id, nonce, deadline) and rebuilds the digest from those same fields.
- **Escrow liveness.** Invariants show that from any reachable state every live link can be refunded and every pool closed after expiry, leaving only pull balances, which `withdraw` empties (`V4.invariant.t.sol`).
- **Metrics.** `/api/stats` now carries `distinctAccounts` (each address once per role and once across roles); the role counts it already had are event counts. The /qday refused list counts a mined transaction once across sources and reports distinct sending accounts.
