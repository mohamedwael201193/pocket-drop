# AI usage

This file says what people did on Pocket Drop and what was done with AI assistance. It is written to be accurate, not flattering.

## Summary

Pocket Drop was built by its human team (the repository owner) working with an AI coding assistant. The team chose the product, the track, the rules and every external action. The assistant wrote most of the code, tests, scripts and documentation under the team's direction. Every claim in the repo is backed by a mined Diana transaction, a test, or a file a script produced. No number was typed in by hand from an AI answer.

## What the team did

- Chose the idea (send QOR by link into a post-quantum smart account) and the Post-Quantum dApp track.
- Set the rules the work follows: contracts frozen after the audit; no mocks, fake numbers or fake users; testnet-only labelling; LIVE/RECORDED badges on every figure; one navigation (Send, Receive, Pocket, Proof); and the design direction.
- Made the decisions that need judgement or carry risk: what to build next, what to cut, when to deploy, and every spend of testnet QOR.
- Owned the wallets and secrets (deployer, relayer, sponsor and test wallets, GitHub and Vercel credentials). Approved the TEAM-RUN QoreX wallet run before it was done.
- Supplied the design images in `frontend/public/`. A script only resized and converted them.
- Reviewed the results, the drafts and the public text before anything was published.

## What was AI-assisted

| Area | What the assistant did | How it was checked |
|---|---|---|
| Solidity (`contracts-v4/src`) | Wrote and revised the contracts to the team's spec: PocketVault, factory, router, PocketDrop, DropPool, PqcLib, PqGuard. | 167 Foundry tests with 100% coverage of `src/`; a two-stage QCAI audit ([docs/AUDIT.md](docs/AUDIT.md)); live attack runs on Diana ([contracts-v4/LIVE_RESULTS.md](contracts-v4/LIVE_RESULTS.md)) |
| Tests | Wrote unit, fuzz and invariant tests, backend and frontend unit tests, and Playwright e2e and QA specs. | CI on every push; the counts are recorded by `frontend/scripts/count-tests.mjs` |
| Relayer API (`backend/`) | Wrote the endpoints, input validation, rate limits, health and stats. | Backend unit tests; the deployed API |
| Web app (`frontend/`) | Wrote the pages and the signing code, and reworked layouts within the given design. | Playwright on the deployed app (Chromium and WebKit, 390 px and 1440 px), screenshots in `frontend/evidence/` |
| Live runs and scripts | Wrote the deploy scripts, the live attack runner, the Q-Day bait setup and the hourly attacker bot, and the re-verification script. | `node frontend/scripts/reverify.mjs` re-checks every recorded hash against the chain |
| Documentation | Drafted the README, AUDIT, THREAT_MODEL, KNOWN_ISSUES and this file. | Reviewed by the team; every number links to its source |
| Audit triage | Read the QCAI reports and proposed a verdict and tests for each finding. | Each verdict names tests that exist and pass |

## AI inside the product

The app itself has no AI features. The only AI service involved is the organisers' QCAI contract audit, which is required by the track.

## Limits

- AI-written code can be wrong in ways tests do not catch. Treat the threat model and known issues as the honest boundary of what has been checked.
- Everything runs on the Diana testnet. Nothing here has been reviewed for mainnet use.
