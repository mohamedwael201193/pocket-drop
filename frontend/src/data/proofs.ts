import recorded from './recorded.json';

export interface RecordedTx { step: string; hash: string; status: string; outcome: string; expected: boolean }
export const REC = recorded as {
  network: { name: string; evmChainId: number; cosmosChainId: string; explorer: string };
  deployer: string;
  main: { address: string; deployTx: string; blockNumber: string; constructorArgsHuman: Record<string, string>; runtimeCodeKeccak: string };
  lab: { address: string; deployTx: string; blockNumber: string; constructorArgsHuman: Record<string, string> };
  build: { solc: string; runtimeCodeBytes: number };
  liveTxs: RecordedTx[];
  liveSummary: { ranAt: string; mainLinkCount: string; labLinkCount: string };
};

/** The six lab attacks; hashes are looked up in the recorded live run (deployments/diana.json), never typed by hand. */
export const ATTACKS = [
  { n: 1, title: 'A mempool thief swaps the recipient', error: 'BadLinkSignature', plain: 'Someone copies the signed bind from the mempool and puts their own address in it. The link key signed a different recipient, so the chain refuses.' },
  { n: 2, title: 'Claim signed by the wrong key', error: 'BadRecipientSignature', plain: 'A claim is signed by a key other than the one registered for the recipient. The precompile check fails.' },
  { n: 3, title: 'Claim into an account with a legacy key', error: 'PossessionNotProven', plain: 'The recipient is a real legacy wallet whose key never proved possession. PocketDrop fails closed.' },
  { n: 4, title: 'Claim into an account with no PQ key', error: 'NotRegistered', plain: 'The recipient has no quantum-safe key on-chain, so nothing is paid out.' },
  { n: 5, title: 'A second person claims a Confirmed link', error: 'BadRecipientSignature', plain: 'Another person with their own proven key tries to claim a link that was confirmed for someone else.' },
  { n: 6, title: 'Sender cancels after confirming', error: 'InvalidState', plain: 'Once the sender confirms the recipient, cancelling is locked, so the recipient cannot be rugged mid-claim.' },
] as const;

export const attackTx = (n: number) => REC.liveTxs.find((t) => t.step.startsWith(`ATTACK ${n} `))!;

/** RECORDED test results, verified by running the commands in this session (see evidence/*.txt). */
export const TESTS = {
  verifiedOn: '2026-11-19',
  foundry: { passed: 117, failed: 0, total: 117, command: 'FOUNDRY_PROFILE=ci forge test', fuzzRuns: 10_000 },
  coverage: { lines: '194/194', statements: '282/282', branches: '54/54', functions: '26/26', command: 'forge coverage --report summary --no-match-coverage "(test|script|lib)/"' },
  backend: { passed: 76, skipped: 9, command: 'cd backend && npx vitest run', note: 'the 9 skipped tests are live-integration tests that need the relayer secret' },
} as const;

export const KNOWN_LIMITS = [
  'Unaudited testnet code. Not for mainnet.',
  'Whoever holds the link key can choose the recipient, so protect the link like cash. Confirmed mode adds the sender check.',
  'The gas drip is paid at first open to the recipient and cannot be recovered by the sender.',
  'An Open-mode link that is bound cannot be cancelled by the sender; money returns only after expiry.',
  'The two native precompiles (0x0A01, 0x0A02) are trusted. PqcLib fails closed but cannot detect a lying precompile.',
] as const;
