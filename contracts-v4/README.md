# Pocket Drop v4 contracts

Post-quantum smart accounts ("Pockets") on QoreChain Diana testnet (EVM 9800). Every sensitive action is an ML-DSA-87 intent verified on chain with `pqcVerify` against the owner's proof-of-possession key. v3 (`../contracts`) stays deployed and untouched.

| Contract | Job |
|---|---|
| `PqcLib` | Fail-closed wrappers for the `0x...0a01` / `0x...0a02` precompiles; the one place the QoreX message format lives (`pqMessage`). |
| `PocketFactory` | EIP-1167 clones at CREATE2 addresses; the salt commits to the whole config; `isPocket`. |
| `PocketVault` | The Pocket: ERC-1271, daily limit, timelocked queue + veto, timelocked limit raise and guardian change, 2-of-3 guardian recovery with delay + owner veto, guardian freeze (72 h) and unanimous guardian recovery (72 h, no veto; the stolen-key path), drop/pool calls. |
| `PocketRouter` | The relayer's single entry; allowlist (factory Pockets, PocketDrop, DropPool); lazy deployment. |
| `PocketDrop` | v4 escrow: sender is a Pocket, claim pays into the recipient's Pocket. |
| `DropPool` | One link, N slots, one slot per PoP account. |
| `PqGuard` + `examples/PqGuardedCounter.sol` | Any dApp can accept a Pocket or a PoP-proven ML-DSA signer. |

Deployed addresses, tx hashes, constructor args and the build record: `deployments/diana.json`. Live results with explorer links: `LIVE_RESULTS.md`. Honest limits: `KNOWN_ISSUES.md`. Security notes, Slither, SPEC deviations: `SECURITY.md`. Coverage: `COVERAGE.md`.

## Message format (one code path for QoreX and browser keys)
The owner signs `"qorechain-msg-v1|qorechain-diana|" + "0x" + hex(keccak256(abi.encode(action, chainid, vault, nonce, deadline, params)))` (UTF-8 bytes). With QoreX: `window.qorex.native.signArbitrary("qorechain-diana", signerBech32, "0x<digest hex>")` and send `pq.signature` (base64 -> bytes) as the `sig` argument. The vault exposes `intentDigest(action, nonce, deadline, params)`; Drop/Pool expose `bindDigest`, `claimDigest`, `linkDigest`. If the data encoding ever changes, edit `PqcLib.pqMessage` only.

## Offer to other teams: PqGuard
```solidity
import {PqGuard} from "./PqGuard.sol";
function act(address account, bytes calldata sig, ...) external {
    bytes32 digest = keccak256(abi.encode("MY_ACTION_V1", block.chainid, address(this), account, nonce[account]++, ...));
    PqGuard.requirePqApproval(account, digest, sig); // Pocket (ERC-1271) or a PoP-proven ML-DSA account
}
```
See `src/examples/PqGuardedCounter.sol` (deployed, used in the live suite). Message size: the signature is 4,627 bytes.

## Tests
```
forge test                                  # default profile (fuzz 1,000 runs, invariants 64 x 30)
FOUNDRY_PROFILE=ci forge test               # CI: fuzz 10,000 runs, invariants 256 x 50
FOUNDRY_PROFILE=coverage forge coverage --report summary --no-match-coverage "test/"
node script/gen-fixtures.mjs                # regenerate the real ML-DSA-87 fixtures (deterministic)
node script/verify-fixtures.mjs             # independent re-verification + negative checks
```
Fixtures are signature-real; the mock verifier accepts only exact triples a test loads (see `SECURITY.md`).

## Deploy and live suite (testnet only; needs the local `.secrets`, never committed)
```
npm ci
node script/deploy.mjs [--check]            # prod (24 h / 48 h / freeze 72 h / unanimous 72 h) and lab instances
node test/live/run.mjs                      # every success path and lab attack as mined txs
```
The relayer window is renewed with `node ../backend/scripts/renew-window.mjs` (targets: both routers and PocketDrop v3); the scheduled workflow does the same.
