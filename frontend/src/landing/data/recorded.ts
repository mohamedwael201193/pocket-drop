// RECORDED facts for the landing. Counts are read from the repo's data files where one exists, so they move with them:
//  - Foundry total: FOUNDRY below, equal to data/v4.json "tests.passed" (contracts-v4/COVERAGE.md, FOUNDRY_PROFILE=ci forge test;
//    re-run 26 Nov 2026: 241 passed, 0 failed). A constant, not an import, so the landing does not download v4.json.
//  - app + API unit tests: data/tests.json (node frontend/scripts/count-tests.mjs)
//  - reverify: the last full run of node frontend/scripts/reverify.mjs (REVERIFY below; re-run 26 Nov 2026: 793 passed, 0 failed)
//  - real-crypto and live-precompile counts: README "Numbers" table (contracts-v4/test-real, contracts-v4/test-live, CI jobs)
// test/landing.test.ts checks every hash below against requirements.ts / v4.json and the counts against their sources.
import appTests from '../../data/tests.json';

export const FOUNDRY = { passed: 241, failed: 0 } as const;
export const REVERIFY = { passed: 793, failed: 0, evm: 402, cosmos: 202, ranOn: '26 Nov 2026' } as const;
export const RECORDED_ON = '26 Nov 2026';
export const COUNTS = {
  foundry: FOUNDRY.passed,
  realCrypto: 26,
  livePrecompile: 31,
  reverify: REVERIFY.passed,
  appTests: appTests.frontend.passed + appTests.backend.passed,
} as const;

export type Tx = { hash: string; what: string; result: 'accepted' | 'reverted' | 'queued' | 'verified' | 'refused' };
/** Mined on Diana testnet; reverify.mjs re-checks each one. */
export const TXS: Tx[] = [
  { hash: '0xd098f67aeebce5e013c65639a3d492343181ea72ac6905c700746689c96980ea', what: 'v5 Pocket deployed, drop created by an ML-DSA-87 intent', result: 'accepted' },
  { hash: '0x08438baf17ecdb80692eb8ed8a393e222ef1cadd67727c91b82ec18263a87a1a', what: 'v5 drop claimed by a newcomer', result: 'accepted' },
  { hash: '0xf72a9a098d5ea3708302968a6caa712b04e3982870d2c7e34e37c28381996318', what: 'a thief swaps the recipient: BadLinkSignature', result: 'reverted' },
  { hash: '0x312c0fe1ecfe1a0159618152ade48639139671adbda5336b4132d06f2a830dcb', what: 'intent signed by another key: BadSignature', result: 'reverted' },
  { hash: '0x4664a69a207575641d38bcf3af724d9f81753c275dd8312c2a66fb3b18be5b5b', what: 'claim without proof of possession: PossessionNotProven', result: 'reverted' },
  { hash: '0x93c9d7434943adf2993be31a87bc6fac1ad11b123f87a9fe226fc6998930b1fc', what: '2.5 QOR above a 2 QOR limit: queued, not paid', result: 'queued' },
  { hash: '0x48ab50d8946248abd715a727727e90b266a6534931f0216b1d3a8c2305288e68', what: 'executed before the timelock: TooEarly', result: 'reverted' },
  { hash: '0xa0042ee4b44a67f65342c8f99aa117229af5d24ca38301dd03b32261b49956cf', what: 'guardians freeze a Pocket, 2 of 3', result: 'accepted' },
  { hash: '0xd4ca2455271a6a0a2f16862632dda34da026789985089753ecab209fdd86f416', what: 'thief spends while frozen: Frozen', result: 'reverted' },
  { hash: '0x97aa69e5597e70fcccd49ad012f85b4ab8bf29ff010317186c5c99135ee05494', what: 'unanimous recovery moves the Pocket to a new key', result: 'accepted' },
  { hash: '0x3aee0b0293126ddb74e2698b733ee83edbb2f9f5881327275fc8837f3af54f4c', what: 'old key after recovery: BadSignature', result: 'reverted' },
  { hash: '0x0c260ee46f71ab773de52868e6cb22ed8c90a91e10bc6e11be357a19064537ef', what: 'v5 pool slot claimed', result: 'accepted' },
  { hash: '04AA17839F57179DA8EC58454F1CD1CEBDDA4D883C86376B4CD92720AF56D445', what: 'relay signed secp256k1 + ML-DSA-87, checked by the chain', result: 'verified' },
  { hash: 'FB826A14E7E1A8A6271E9489E2BA12BF17075CC793479720F981594F758F00D3', what: 'Q-Day attempt with a published key: refused', result: 'refused' },
];
