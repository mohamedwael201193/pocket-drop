# Pocket Drop relayer API (QoreChain Diana testnet)

Vercel serverless functions (Node 20+, TypeScript, zod, viem). Testnet only: every JSON response carries `network: "diana-testnet"`.
Vercel project: `pocketdrop-api`. Production alias: https://pocket-drop-api.vercel.app

## Endpoints

| Route | Purpose |
|---|---|
| `POST /api/bind` | Relayer submits a user-signed `bind(linkId, recipient, recipientKeyHash, linkPk, linkSig)`. |
| `POST /api/claim` | Relayer submits a user-signed `claim(linkId, recipientSig)`. |
| `GET /api/link/:id` | Reads `getLink(id)` from chain (state/mode names, amounts as wei strings). |
| `GET /api/stats` | Counts, volume and distinct addresses indexed from contract events, own vs external. |
| `GET /api/health` | Relayer address, balance, EVM window status (remaining blocks/txs/value), contract, network, and a `warnings` list: `relayer-balance` when the balance is below `relayer.lowBalanceThreshold` (3 QOR by default, env `RELAYER_LOW_BALANCE_QOR`; `relayer.lowBalance` is then true) and `relayer-window` when fewer than 2,000 blocks remain or the window is not live. Warnings do not change the status code. 503 if the contract is unset, or (EVM mode only) the window is not live. It also returns `relay: {mode, signature, fallback, classicalPathOpen}`. |
| `POST /rpc` | Key-less CORS proxy to the CometBFT RPC. Allowed methods: `status abci_info abci_query broadcast_tx_sync broadcast_tx_async tx tx_search block health`. Max 10 calls per batch. |
| `GET /rest/*` | Key-less CORS proxy to the REST API. Allowed prefixes: `/cosmos/auth/v1beta1/accounts/`, `/cosmos/bank/v1beta1/balances/`, `/cosmos/tx/v1beta1/txs/`, `/cosmos/upgrade/v1beta1/applied_plan/`, `/cosmos/base/tendermint/v1beta1/`, `/qorechain/pqc/v1/`. Path traversal is rejected. |

### bind / claim

Body (JSON): `bind` = `{ linkId, recipient, recipientKeyHash, linkPk, linkSig }`, `claim` = `{ linkId, recipientSig }`.
`linkId` is a decimal string or integer; `recipient` must be a valid address (mixed case must match the EIP-55 checksum); `recipientKeyHash` is 32 bytes; `linkPk` exactly 2592 bytes; `linkSig`/`recipientSig` exactly 4627 bytes (all `0x` hex). Unknown fields are rejected.

Pipeline: rate limit, validate, ABI-encode, `eth_call` pre-simulation as the relayer, then send with an explicit gas limit (`GAS_BIND` 900000, `GAS_CLAIM` 800000), wait for the receipt.

- `200` `{ ok, txHash, status: "success", blockNumber, gasUsed, gasLimit, explorer }`
- `422` simulation reverted: `{ ok:false, sent:false, error:{ name, message, selector, known } }` (decoded custom error such as `BadLinkSignature`, `BadRecipientSignature`, `PossessionNotProven`, `NotRegistered`). Nothing was submitted.
- `400` validation error (`error.issues`), `429` rate limited (`retry-after`), `503` relayer window closed/exhausted or contract/key not configured, `502` mined but reverted / RPC failure.

The relayer never receives, stores or logs a user secret: it only forwards signatures and public keys that the contract verifies on-chain.

## Environment variables

| Name | Where | Meaning |
|---|---|---|
| `RELAYER_SECP_KEY` | Vercel (sensitive) | Relayer secp256k1 private key (0x + 64 hex). The only key the server holds. |
| `POCKETDROP_ADDRESS` | Vercel | Deployed PocketDrop contract. Also read by scripts, or from `../contracts/deployments/diana.json`. |
| `POCKETDROP_DEPLOY_BLOCK` | Vercel (optional) | First block to index for `/api/stats`. Without it the scan looks back `STATS_LOOKBACK_BLOCKS` (default 150000). |
| `EVM_RPC_URL`, `REST_URL` | optional | Defaults `https://evm-testnet.qore.host`, `https://api-testnet.qore.host`. |
| `GAS_BIND`, `GAS_CLAIM` | optional | Explicit gas limits. Receipt gasUsed is floored at 50% of the limit, so keep them tight. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | optional | Shared rate-limit counters. |

No secret is stored in this directory. Secrets live only in `D:\route\QORE\.env`, `D:\route\QORE\.secrets\` and Vercel env vars.

## Rate limits

Per IP: bind 10/min, claim 10/min, link reads 120/min, stats 20/min, proxy 300/min. Per linkId: bind and claim 6 per 10 min each.
Default store is in-memory: on serverless each warm instance has its own counters, so the effective limit is per instance, not global. Set the Upstash variables for a shared counter (it falls back to memory if Upstash is unreachable). Rate limits are friction, not a security boundary; the hard bounds are the contract and the chain-enforced window below.

## Stats and "own" accounts

`/api/stats` pages `eth_getLogs` in bounded ranges (5000 blocks per call, halved on RPC range errors, max 40 calls; `truncated: true` when capped), decodes `LinkCreated/Bound/Confirmed/Claimed/Cancelled/Refunded` and others, and returns counts, volume, and distinct addresses split into `own` (listed in `config/own-accounts.json`: deployer, relayer, burner, main test wallet, test recipients) and `external`. These are addresses, not users. Results are cached 30 s in memory.

## Trust model

- Since 22 Nov 2026 the serving relayer (Vercel) holds both relayer keys: `RELAYER_SECP_KEY` and `RELAYER_PQC_SEED`, with `RELAY_MODE=hybrid`. Every relay is a native `MsgCrossVMCall` to the PocketRouter (or the v3 PocketDrop), signed with secp256k1 + ML-DSA-87. The chain verifies both and records `pqc_hybrid_verify status=verified` (`src/hybridRelayer.ts`). Each relay is dry-run first and never broadcast if it would fail; gas = dry run + 15%.
- The relayer can only pay gas. Every payout needs a link-key ML-DSA signature (bind) and the recipient's registered ML-DSA key signature (claim), and every Pocket action needs the owner's ML-DSA intent, all verified by the contracts through the `pqcVerify` precompile. A relayer cannot redirect funds: changing the recipient in `bind` gives `BadLinkSignature`; claiming with a wrong key gives `BadRecipientSignature`.
- The relayer's EVM window is closed, so its classical key alone cannot send anything (an ECDSA-only relay is refused at broadcast; `contracts-v4/LIVE_RESULTS.md`, "Hybrid relay lane"). `/api/health` reports `relay.classicalPathOpen`.
- Key custody: whoever compromises the Vercel environment or the repo secrets holds both relayer keys. They can spend the relayer's gas float (see `relayer.balance` in `/api/health`), open a window for the relayer account, or stop relaying. They can NOT move escrow or Pocket funds. Senders can still cancel/refund from their own account, and anyone can submit a signed claim with their own gas.
- A cross-VM call leaves no EVM log. `/api/xvm?env=prod|lab` lists the hybrid relays found on the native lane (`crossvm_request.target_contract`) and the drop and pool events rebuilt from their calldata and return values; `/api/stats` adds them to the log counts.

## Fallback: the EVM window (manual)

The API falls back to an ECDSA EVM transaction only before broadcast (signer, account read or CheckTx failure), and only if a window is open. To switch the hybrid lane off: set `RELAY_MODE=evm` on `pocketdrop-api`, re-open the window with `.github/workflows/renew-window.yml` (manual dispatch) or locally, and redeploy:

```
cd backend
node scripts/renew-window.mjs --blocks 17280 --txs 500   # needs .secrets/pocketdrop-relayer.json or RELAYER_SECP_KEY + RELAYER_PQC_SEED
```

It hybrid-signs `MsgOpenEVMWindow` scoped to the prod router, the lab router and the v3 PocketDrop, with `max_value` = `evmWindowCost * txs` plus headroom. Keep the relayer funded.

## Other scripts

- `scripts/setup-relayer.mjs` (one-time, done): generates the secp + ML-DSA seeds, funds from the main test wallet, registers the PQ key with proof of possession.
- `scripts/sync-abi.mjs`: regenerates `src/abi.ts` from `contracts/out/PocketDrop.sol/PocketDrop.json` (`npm run sync-abi`).

## Development

```
npm install
npm test                  # vitest unit tests
npm run coverage          # v8 coverage on src/
npm run typecheck
PD_API_URL=https://pocket-drop-api.vercel.app npx vitest run test/integration.test.ts   # deployed endpoints (skipped otherwise)
npx vercel deploy --prod  # needs VERCEL_TOKEN in the environment
```
