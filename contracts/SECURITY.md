# Security notes (Pocket Drop contracts, Diana testnet only)

Honest status: unaudited testnet code. Not for mainnet.

## Threat model
- Anyone can call `bind`, `claim`, `refund`. Authority comes from signatures, not from `msg.sender`.
- `bind` needs an ML-DSA-87 signature by the link key over `abi.encode("POCKETDROP_BIND_V1", chainid, this, linkId, recipient, recipientKeyHash)`. A mempool thief who swaps the recipient invalidates it (`BadLinkSignature`, live attack 1).
- `claim` needs the recipient's key to be registered on chain (algo 1, possessionProven) with `keccak256(pubkey) == recipientKeyHash`, and a signature over the claim digest (`POCKETDROP_CLAIM_V1`, chainid, this, linkId, recipient).
- Domain separation: chain id and contract address are inside both digests; replay across chains, instances or links fails (tested with real signatures over wrong messages).

## Trust assumptions
- The two native precompiles (0x0A01 verify, 0x0A02 key status) are correct and honest. `PqcLib` is fail-closed against failures and malformed data but cannot detect a lying precompile.
- Whoever holds the link (link ML-DSA key) can choose the recipient. In Open mode the first valid bind wins and the bound recipient can claim immediately; Confirmed mode adds a sender check of the recipient key fingerprint.
- No owner, admin, pause or upgrade. Constants are immutable.
- The relayer holds no user secret; it can only submit user-signed payloads (and collect `relayerFee` at first bind).

## Invariants (tested: unit, fuzz, stateful invariant handler)
1. balance >= sum(unpaid escrow of live links) + sum(pull balances); in tests it is exactly equal.
2. A link pays its amount at most once.
3. The amount goes only to the recipient bound at claim time.
4. Cancel and refund pay only the sender.
5. No amount payout unless the recipient key is registered, ML-DSA-87, proven and matches `recipientKeyHash`.

## Mechanisms
- Reentrancy lock on every state-changing function, checks-effects-interactions everywhere value moves.
- Direct payouts use a 100,000 gas stipend via raw `call` (no return-data copy); failure credits `pending[account]`, so a hostile receiver can never block claim, cancel, refund or bind. `withdraw` forwards all gas but only to the caller.

## Slither (0.11.6, `slither-report.txt`)
Findings, all reviewed and accepted:
- incorrect-equality `value == 0` in `_pay`: intended zero-skip.
- timestamp comparisons: inherent to expiry/deadline logic; miners can shift by seconds only. Windows are minutes to days.
- assembly / low-level-calls: deliberate (`staticcall` to precompiles, return-bomb-safe `call`), covered by tests.
- cyclomatic complexity of `claim` (12): a linear sequence of guards.
- naming-convention for UPPER_CASE immutables: spec-mandated names.

## Known limits
- Daily drip allowance is debited at `create` and never credited back (cancel/refund do not restore it).
- Open-mode link that is Bound cannot be cancelled by the sender (spec); funds return only after expiry via `refund`. After the bind deadline passes in Open mode the old recipient cannot claim until someone (link holder) rebinds.
- `relayerFee` and `drip` are paid at first bind to the bound recipient and caller even if that recipient never claims; the drip is not recoverable by the sender (only unpaid portions are refunded).
- The link key holder can bind a recipient of their choosing: protect the link like cash.
- ML-DSA signature size is not pre-checked; the precompile decides.
- The mock verifier in Foundry tests is signature-real but is not the chain's precompile; the live suite is the end-to-end proof.
- `block.timestamp` day boundaries (UTC) define the drip cap.

## SPEC deviations (tightenings, all safe)
1. `bind` reverts `Expired` at or after `expiry`.
2. `confirm` additionally requires `now <= bindDeadline`; extra `confirmRecipient(id, expectedKeyHash)` closes the rebind race.
3. `recipient == 0` / `this` and zero `recipientKeyHash` are rejected in `bind`.
4. Precompile failure in `claim` gives `KeyStatusUnavailable` (distinct from `NotRegistered`).
