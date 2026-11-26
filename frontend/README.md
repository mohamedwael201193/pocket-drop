# Pocket Drop frontend

> **Testnet only. Diana, no monetary value.** React 18 + Vite + TypeScript + Tailwind + framer-motion + react-query + zod.

Live: https://pocket-drop.vercel.app

A sender creates a link, a friend with **no wallet** opens it, and a quantum-safe QoreChain account is born in their browser with the QOR in it. The app talks to the deployed `PocketDrop` contract (`0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97`) and the relayer API (`https://pocket-drop-api.vercel.app`).

## Pages

| Route | What it does |
|---|---|
| `/` | Overview: the original design (hero, onboarding, phone, architecture). Every figure is LIVE (latest claimed drop from the API, relayer window) or RECORDED with its source. |
| `/dashboard` | Drops & Escrow Control: sender account and activation, Drop Builder (Confirmed or Giveaway, any chat app incl. WhatsApp), 4-word confirmation console, relayer window gauge, live ledger. |
| `/claim` | Paste a link, plus a clearly labelled walkthrough illustration of the phone flow. |
| `/c/:id#k=<seed>` | Claim. Keygen in the tab, `/api/bind`, PoP registration, scoped EVM window, 4-word fingerprint, `/api/claim`, live balance. |
| `/radar` | Telemetry from `/api/stats`, `/api/health` and the chain; recorded step latency (Playwright, deployed app) and real-phone timings. `/stats` redirects here. |
| `/lab` | The six attacks with recorded tx hashes, plus a button that really re-runs each one against the chain state it faced (receipt + `eth_call` at the previous block). |
| `/judges` | 60-second checklist with live contract reads, relayer health and recorded test results. |

Every number carries a badge: **LIVE** (read from chain/API when the page loaded) or **RECORDED** (taken from files in this repository).

## How the flow works

- The link is `https://<app>/c/<linkId>#k=<64 hex>`. The 32-byte seed is only in the `#fragment`, which browsers never send to servers. The ML-DSA-87 link key is `keygen(seed)`; only `keccak256(publicKey)` is on-chain.
- The recipient generates a fresh secp256k1 + ML-DSA-87 account in the tab, signs the bind message with the link key, and the relayer submits `bind` (paying gas and the drip). The recipient registers the key with proof of possession, opens a window scoped to PocketDrop, and signs the claim message. The signing code is a port of the phone-proven spike.
- Confirmed mode: the sender sees `fingerprint(recipientKeyHash)` (4 words from the 2048-word BIP-39 list, 44 bits) and calls `confirmRecipient(id, expectedKeyHash)` from their account. The recipient's claim starts only after that. Giveaway (Open) mode has no confirm step.
- **Sender activation.** QoreChain refuses EVM transactions from an account that has no registered ML-DSA key and no open authorisation window. So the first time a sender account is funded, the app registers its key (PoP) and opens a PocketDrop-scoped window (about 0.16 QOR in fees). This is a one-time step.
- Sender accounts live in this browser's `localStorage` (key shown as a backup option). Funding: the [official faucet](https://dashboard.qorechain.io/faucet) with the shown `qor1…` address, or send QOR to the shown `0x…` address.

## Develop

```
cp .env.example .env     # optional: defaults point at the deployed contract and API
npm install
npm run dev
npm run build
```

## Tests

```
npm run typecheck
npm run lint
npm test                 # unit tests + LIVE digest tests (needs network)
E2E_URL=https://pocket-drop.vercel.app npx playwright test    # deployed-URL E2E, 390x844, Chromium + WebKit
node scripts/verify-tx.mjs                                        # receipts for every tx hash in evidence/
```

- `test/digests.live.test.ts`: the bind and claim messages built in the browser are byte-equal to the contract's `bindDigest` / `claimDigest` (eth_call, main and lab), and the chain's `pqcVerify` precompile accepts a signature made by this code.
- `e2e/flow.spec.ts`: a real sender and a real recipient in two browser contexts, Confirmed and Open. The sender is funded from the testnet deployer by `scripts/fund.mjs` (15 QOR total cap, tracked in `evidence/spend.json`). Secrets are read in-process and never printed.
- `e2e/privacy.spec.ts`: `og:` tags are served without the fragment and no request ever carries the seed.
- `evidence/` holds screenshots, per-run JSON with every tx hash, and the verification output. See [WHATSAPP_TEST.md](WHATSAPP_TEST.md) for the WhatsApp check.

## Environment

`VITE_API_BASE`, `VITE_EVM_RPC`, `VITE_POCKETDROP_ADDRESS`, `VITE_LAB_ADDRESS` (see `.env.example`). No secrets are used by the app.
