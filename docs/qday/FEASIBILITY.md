# Q-Day drill: feasibility (contract code + live Diana testnet)

Run: 20 Nov 2026, 06:04 to 06:12 Cairo (UTC+2). Diana testnet only (EVM 9800, `qorechain-diana`); QOR has no value.
Contracts: v4 PROD (router `0xb0d8fd23...f209`, factory `0x74b604e8...3e8f`, drop `0xbc13b9ee...1f00`), unchanged. No contract change made.
Raw records: `docs/qday/feasibility-results.json` (44 rows). Chain re-check: `verify-feasibility.mjs` (37 hashes, 37 OK, 0 bad; EVM via `eth_getTransactionReceipt` on https://evm-testnet.qore.host, Cosmos via CometBFT `/tx`).
Spend: 2.1 testnet QOR from the main test wallet (about 0.9 QOR still sits in the test accounts).

## Verdict

1. **Feasible, but only with a fixed key derivation.** A Pocket whose ML-DSA-87 secret is truly independent of its secp256k1 key held against every path we could find. An attacker holding only its classical key moved nothing: 0 of 19 attack attempts succeeded. The Pocket stayed at 0.2 QOR, the key account at 0.34 QOR, the registered PQ key did not change, and the Pocket nonce stayed 0.
2. **BLOCKER: today's browser Pockets are NOT quantum-safe.** `frontend/src/lib/recipient.ts` (`deriveRecipient`) and `frontend/src/lib/identity.ts` use the 32-byte root as the secp256k1 private key AND derive the ML-DSA secret as `sha256(root | "|mldsa87")`. So whoever holds the classical key also holds the PQ key. At Q-Day, a quantum attacker recovers the secp256k1 private key from the public key, which is on chain from the first signed tx. From that key they compute the ML-DSA key and own the Pocket. We proved it live: from the root alone we derived the registered ML-DSA key and moved Pocket funds (W1 below). QoreX / mnemonic accounts are not affected: the SDK derives their PQ key from the mnemonic (`shake256("qorechain:pqc:v1|"+cosmos+"|"+mnemonic)`), not from the secp child key.
   **Fix (frontend only, no contract change; being done separately):** make the secp key a one-way function of a master secret (for example, secp = sha256("pd:secp:v2|" + root), ML-DSA = sha256(root | "|mldsa87")) or use a separate random `pqcSecret`. Version-tag the stored root. Existing v1 roots keep working but must be labelled "not quantum-safe" and migrated: move the funds to a new v2 Pocket, or use a guardian recovery to a v2 key. Note that `MsgRotatePQCKey` alone does not help a Pocket, because the Pocket pins its owner key hash.
3. **Residual path to design around: a live EVM window.** While an owner's EVM window is open, the classical key alone can send EVM txs inside that window's scope and value (O2 succeeded). Opening a window needs the hybrid signature, so a bait account must never have a live window. Note that the v3 sender activation (`activateSender`) opens a 17,000-block window scoped to PocketDrop v3 with the spendable balance.

## Keys in one Pocket setup (from code)

| Key | What it is | What controls it |
|---|---|---|
| Root (browser) | 32 random bytes in `localStorage` `pd.root.v4` | today it IS the secp key (the flaw) |
| secp256k1 key | the "key account": one identity, `0x...` on EVM and `qor1...` on Cosmos (eth_secp256k1) | signs the one-time PoP registration (classical, bootstrap-exempt); half of every hybrid Cosmos tx; EVM txs, but only inside a live window |
| ML-DSA-87 key | registered on the key account with proof of possession (`pqcKeyStatus.possessionProven`) | the other half of every hybrid tx; signs every Pocket intent |
| Pocket | EIP-1167 clone; `owner` = key account; `ownerKeyHash` = keccak of the ML-DSA key, pinned at `initialize` and changed only by guardian recovery | `_auth` → `PqcLib.verifyForKey(owner, ownerKeyHash, pqMessage(digest), sig)` → `pqcVerify` precompile |
| Guardians | other PoP accounts; keys read live (not pinned) | rotating a guardian key also needs the hybrid signature (A3/A4), so a guardian's classical key alone is not enough either |
| Link key | pure ML-DSA key from the link fragment seed | bind / pool claim; not related to the account keys |

## Live attack results (attacker = V's secp256k1 key + the attacker's own ML-DSA key; never V's real ML-DSA secret)

Setup: V = fresh account with an independent random ML-DSA secret (the fixed derivation). V's Pocket `0xD6b6Fd3D68aD53E8FD6018099A32c01BaB4aa58b`: guardians G1/G2, threshold 2, daily limit 0.05, funded 0.2 QOR (deploy `0xf97b6216...c2db`, fund `0xc9d917fc...1ec1`). The attacker submits EVM txs from its own account X (registered + windowed) through the prod router, which is the same route any outsider would use.

Cosmos-lane attempts (rejected in CheckTx, never included, no fee charged; the hash is the local sha256 of the signed tx):

| # | Attempt | Result |
|---|---|---|
| A1 | bank send out of the key account, classical-signed | code 20 "has a registered PQC key and must include the hybrid signature extension" (`F9D78755...549B`) |
| A2 | same, hybrid-signed with the attacker's ML-DSA key | code 21 "hybrid PQC signature verification failed" (`339E16C3...FAEF`) |
| A3 | re-register a new PQ key (MsgRegisterPQCKeyV2 + valid PoP), classical | code 234 "PQC key maintenance from a keyed account needs the hybrid signature" (`3DD15725...067D`) |
| A3b | same, hybrid with the attacker key | code 21 (`790745AD...B185`) |
| A3c | deprecated MsgRegisterPQCKey v1, classical | code 234 (`99AFBF51...9DC2`) |
| A4 | MsgRotatePQCKey to the attacker key (forged old signature), classical | code 20 (`A8B7AAEB...D461`) |
| A4b | same, hybrid with the attacker key | code 21 (`59D9EDDA...4B08`) |
| A5 | open an EVM window, classical | code 20 (`5A301B27...28DC`) |
| A5b | open an EVM window, hybrid with the attacker key | code 21 (`3309B699...0BA3`) |
| A6 | raw EVM transfer from the key account's 0x address (no window) | refused at broadcast: "has no open EVM authorisation window" (no hash) |
| A7 | link an attacker key as an abstract-account authenticator (spending rules + MsgRegisterAuthenticator, send+evm), classical | code 20 (`49D1FDB5...AB80`) |
| A7b | same, hybrid with the attacker key | code 21 (`7DDDE97D...2FC0`) |

Pocket / drop attempts (mined, reverted; the revert reason was decoded with eth_call first):

| # | Attempt | Tx | Revert |
|---|---|---|---|
| E0 | control: the SAME spend intent signed by the real owner key (eth_call only, not mined) | - | no revert, so the reverts below are about the key |
| E1 | `spend` 0.04 to the attacker, attacker ML-DSA signature | `0xddd488e3ebb527033233fb4123c377aa9337c7876636ab65d0fa58270452ea4b` | BadSignature |
| E2 | `spend`, signed with V's classical ECDSA key | `0x2c982da910d14ccd6f48da6231d9268e3fabbe48edbc69bbb506e9f4baa8e769` | BadSignature |
| E3 | `setGuardians` to an attacker set | `0x03f42b58964aa8fe302dd5d4a920d26c5a4cda75d647fcedf82b4943aabf9aeb` | BadSignature |
| E4 | `setLimit` 100 QOR | `0xdafb6fdd0e09e895ccb03a766b06c5cf8580aaf459ddbdd92943cc9d1a4d1b25` | BadSignature |
| E5 | `cancelPending` | `0x4dbd92beb4140caf582731f7b26b584bf861cceb0c6593b758298b0fdae267aa` | BadSignature |
| E6 | `createDrop` (Giveaway link held by the attacker) | `0x8b72d5c3de9259475c9f0ed1d50b892325a9c742de7c96bf36b69e09d05be5d5` | BadSignature |
| E7 | `proposeRecovery` to the attacker with forged guardian signatures | `0xf444d843ad19e50a86576a71f3c3ddc22d6016fcc8944355abbbcd58dfeb9927` | BadSignature |
| E8 | `executeQueued(1)` | `0xbe5cccd91caee06bf2cda663d743a4c85c53d1de01d7840ce1605cd0b95414ed` | NotQueued |
| E9 | `PocketDrop.cancel(19)` of someone else's link | `0x8948a203fc393e5181f698f78814f40dbbc87c5628cd094bd9f027481bc88c52` | NotSender |
| E10 | ERC-1271 `isValidSignature` with an ECDSA / attacker ML-DSA signature (eth_call) | - | `0xffffffff` for both |

After: key account 0.34 → 0.34, Pocket 0.2 → 0.2, PQ key unchanged, nonce 0.

Paths covered by code reading only (not mined): `vetoQueued`/`vetoRecovery`/`confirmDrop`/`cancelDrop`/`createPool`/`closePool` all go through the same `_auth` as E1. `guardianFreeze` and `proposeRecoveryUnanimous` need guardian signatures (E7 shows that check). `PocketDrop.claim` pins `recipientKeyHash` at bind, and `bind` needs the link key. `DropPool.claim` needs the link key plus a PoP key. A counterfactual (undeployed) Pocket pins whatever key is registered at deploy time, but the attacker cannot change that key (A3/A4), so lazy deployment is safe too.

## The flaw, live (W = account built exactly like today's browser)

| # | Step | Tx | Result |
|---|---|---|---|
| W0 | from the secp256k1 key (root) only, derive the ML-DSA key | - | it equals the registered key |
| W1 | Pocket `0x803B3ACEf3e7C7c54580663d1BFa05adA8cB6B17`: `spend` 0.04 to the attacker, signed with the derived key | `0x445b5443b9793485d1bac034e8c3fb0aa5021bd1efdf41a544272b21257b8893` | **success**, Pocket 0.05 → 0.01 |
| W2 | hybrid bank send 0.1 out of W's key account with the derived key | `6099946011B4F4ED...1A1C` (height 10411948) | **success**, 0.24 → 0.08 |

(Funds moved to our own account X. Both accounts are ours.)

## Window residual (V, real owner opens a window, then the attacker uses only the classical key)

| # | Step | Tx | Result |
|---|---|---|---|
| O1 | owner opens a window (300 blocks, 2 txs, scoped to X) with its real hybrid key | `3463DF93...776C` | ok |
| O2 | attacker with ONLY the secp key sends 0.02 QOR to X | `0x5e58ba704f48e173ddac3b0a1b0782f386945c7adbef6a63d0847ce98493c03c` | **success** |
| O3 | same, to an address outside the scope | refused at broadcast ("does not list ... as an allowed recipient") | blocked |
| O4 | owner closes the window | `F6B332B9...0E30` | closed |

## Legacy control (an account with no PQ key)

L1, a classical-only bank send from an unregistered account, was refused: code 8, "account has no PQC key and classical fallback is disabled" (`823F8B85...103E`). So on Diana today a key-less account cannot move funds classically at all (only the bootstrap registration is exempt). A "legacy bait that gets drained" is therefore NOT possible on Diana, and the drill cannot use one as a contrast. The Rescue story has to rely on the main wallet's `possessionProven=false` state as recorded, not on a live drain. Also, 0.1 QOR is now stuck in that account unless it registers a key.

## Reproduce
- `node contracts-v4/script/qday/verify-feasibility.mjs` re-reads every recorded hash from the chain (read-only, plain Node 20).
- `node contracts-v4/script/qday/attack.mjs` runs every path against the live bait Pockets in read-only mode (check_tx + eth_call).
