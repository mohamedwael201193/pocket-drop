# Pocket Drop — frozen build spec (v3)

This spec is the contract both build agents follow. Change it only via the orchestrator.

Network: QoreChain testnet **Diana**, EVM chain id 9800, Cosmos chain id `qorechain-diana`. Testnet only, everywhere.
Live-proven references (see `../feasibility/live_r3.md`, `../spike/VERDICT.md`):
- `pqcVerify(bytes pk, bytes sig, bytes msg) returns (bool)` at `0x0000000000000000000000000000000000000A01`: pure ML-DSA-87; bad input returns false, never reverts.
- `pqcKeyStatus(address) returns (bool registered, uint8 algoId, bytes pubkey, bool possessionProven)` at `0x…0A02`. ML-DSA-87 is algoId 1.
- EVM txs need an open EVM window (`MsgOpenEVMWindow`, hybrid-signed). An account holding only its secp key cannot widen the window or MsgSend (code 20).
- Receipt `gasUsed` is floored at 50% of the gas limit; use explicit, tight gas limits.

## 1. Product sentence
Send testnet QOR to a friend who has no wallet: they open a link and get a quantum-safe QoreChain account with the money in it.

## 2. Contract `PocketDrop.sol` (Solidity ^0.8.24, no owner, no admin, no upgradeability)

### Constants (immutable, constructor args)
- `MIN_ESCROW`, `MAX_AMOUNT` (per link)
- `MAX_DRIP` (per link) and `DAILY_DRIP_CAP` (per sender per UTC day, debited at `create`)
- `BIND_TIMEOUT` (seconds)
- `MAX_EXPIRY` (max seconds from create)

### Storage per link (`linkId = uint256`, incrementing from 1)
- `sender`, `mode` (0 = Confirmed, 1 = Open), `state`
- `amount`, `drip`, `relayerFee`
- `expiry`, `bindDeadline`
- `linkKeyHash` = keccak256(link ML-DSA-87 public key)
- `recipient`, `recipientKeyHash` = keccak256(recipient ML-DSA-87 public key)
- `dripPaid` (bool)

States: `Open → Bound → (Confirmed) → Claimed`. Terminal states are `Claimed`, `Cancelled` and `Refunded`.

### Functions
- `create(bytes32 linkKeyHash, uint8 mode, uint64 expiry, uint96 drip, uint96 relayerFee) payable returns (uint256 linkId)`
  - `msg.value = amount + drip + relayerFee`, with `amount >= MIN_ESCROW` and `amount <= MAX_AMOUNT`.
  - `drip <= MAX_DRIP`; the daily drip cap is debited here.
  - `expiry` must be in the future and `<= now + MAX_EXPIRY`.
- `bind(uint256 linkId, address recipient, bytes32 recipientKeyHash, bytes linkPk, bytes linkSig)`
  - Callable by anyone (the relayer).
  - Requires `keccak256(linkPk) == linkKeyHash`.
  - Requires `pqcVerify(linkPk, linkSig, abi.encode("POCKETDROP_BIND_V1", block.chainid, address(this), linkId, recipient, recipientKeyHash))`.
  - Allowed when the state is `Open`, or when it is `Bound` and `block.timestamp > bindDeadline` (rebind after timeout; never once `Confirmed`).
  - Sets the recipient fields and `bindDeadline = now + BIND_TIMEOUT`.
  - On the first bind only, pays `drip` to the recipient and `relayerFee` to `msg.sender` (CEI; failed sends go to a pull balance).
- `confirm(uint256 linkId)`: sender only, Confirmed mode, state `Bound`, not expired → state `Confirmed`. (Off-chain, the sender checks a 4-word fingerprint of `recipientKeyHash` read aloud by the recipient.)
- `claim(uint256 linkId, bytes recipientSig)`
  - Callable by anyone (the relayer).
  - The required state is `Confirmed` in Confirmed mode, or `Bound` within `bindDeadline` in Open mode. Not expired.
  - `pqcKeyStatus(recipient)` must return registered, algoId == 1, possessionProven, and `keccak256(pubkey) == recipientKeyHash`.
  - `pqcVerify(pubkey, recipientSig, abi.encode("POCKETDROP_CLAIM_V1", block.chainid, address(this), linkId, recipient))` must be true.
  - Sets `Claimed` and pays `amount` to the recipient (pull fallback).
- `cancel(uint256 linkId)`: sender only. Allowed in `Open` (both modes), or in `Bound` in Confirmed mode (before confirm). Refunds `amount` plus any unpaid drip and fee to the sender.
- `refund(uint256 linkId)`: anyone, after `expiry`, if the link was not claimed, cancelled or refunded. Refunds everything unpaid to the sender.
- `withdraw()`: pull-payment balances.
- Views: `getLink(id)`, `bindDigest(...)` and `claimDigest(...)`, which return the exact `abi.encode` bytes that must be signed.

### Rules
- `PqcLib` wraps both precompiles with `staticcall` and is fail-closed:
  - A call failure, short or malformed return data, or any decode doubt → false / not proven.
  - Never assume a tuple length.
  - Never revert inside the library on bad input; the callers revert with custom errors.
- Custom errors and events for every state change. ReentrancyGuard plus CEI everywhere value moves.
- Invariants:
  1. `address(this).balance >= Σ unpaid escrow (amount + unpaid drip + unpaid fee of non-terminal links) + Σ pull balances`.
  2. A link pays its amount at most once.
  3. The amount goes only to the recipient bound at claim time.
  4. Refunds and cancels go only to the sender.
  5. No payout of the amount to an address whose key is not registered with possessionProven and does not match `recipientKeyHash`.

## 3. Tests (Foundry), target 100% line + branch coverage on `src/`
- Unit tests for every branch and every custom error.
- Fuzz tests (≥10k runs in CI profile): amounts, expiries, modes, mutated pk, sig and message bytes, wrong domains.
- Invariant tests with a handler mixing create, bind, rebind, confirm, claim, cancel, refund, withdraw and time warps.
- Precompile mocks are installed with `vm.etch` and must be **signature-real**: the mock verifier accepts only (pk, sig, msg) triples produced by real ML-DSA-87 (via `vm.ffi` to a node script using `@noble/post-quantum` / `@qorechain/pqc`, or a committed fixtures file generated by that script). Do not use a "return true" mock.
- **Live suite** (`test/live/*.mjs`, viem + qorechain sdk): runs every success path and each lab attack as real Diana txs against the deployed contract, and records hashes to `deployments/diana.json`. Foundry cannot fork native precompiles; this suite replaces fork tests and says so in the README.

## 4. Lab attacks (live, each a mined tx with a revert or the expected outcome)
1. Mempool thief swaps the recipient in `bind` → `BadLinkSignature`.
2. `claim` with a signature from a key other than the recipient's registered key → `BadRecipientSignature`.
3. `claim` into an account whose key has possessionProven=false → `PossessionNotProven`. (Use the main test wallet `0x8ab5…8bBDd` as the PoP-false account; it is real and legacy.)
4. `claim` to an account with no PQ key → `NotRegistered`.
5. A second person tries to claim a Confirmed link → reverts.
6. Sender `cancel` after `confirm` → reverts.

## 5. Backend (relayer), `backend/`
- Vercel serverless (Node 20+), deployed as project `pocketdrop`.
- Endpoints:
  - `POST /api/bind` and `POST /api/claim`: the relayer submits the user-signed payloads. Input is validated with zod. The relayer never sees any user secret.
  - `GET /api/link/:id`: reads chain state.
  - `GET /api/stats`: indexed from contract events, splitting our own accounts from external ones.
  - `/rpc` and `/rest/*`: a key-less CORS proxy (allowlisted hosts, methods and paths), reused from the spike.
- The relayer holds ONLY a secp256k1 key, in the Vercel env var `RELAYER_SECP_KEY`.
  - Its ML-DSA key stays local in `.secrets/`.
  - `scripts/renew-window.mjs` (run locally) opens the relayer's window, scoped to `[PocketDrop]` with a value cap.
- Rate limits per IP and per link. Gas limits are explicit.
- Every response says `network: "diana-testnet"`.

## 6. Secrets and publishing
- Secrets live only in `D:\route\QORE\.env`, `D:\route\QORE\.secrets\` and Vercel env vars.
- Never commit, print or log them.
- The repo has a `.gitignore` covering `.env*`, `.secrets/`, `node_modules/`, `out/`, `cache/`, `broadcast/` and `*.key`.
- Before any push, run a secret scan (gitleaks if available, else grep for the known secret prefixes and 64-hex strings) and fail on a hit.
- The public repo is `github.com/mohamedwael201193/pocket-drop`, MIT licensed.
