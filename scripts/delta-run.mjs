// Measured-delta run, entry point from the repo root. Needs `cd contracts-v4 && npm ci` and `forge build` first (it uses the
// contract ABIs from contracts-v4/out and the packages in contracts-v4/node_modules). See contracts-v4/script/delta-run.mjs.
//   QORE_ENV_FILE=<file with seed=<funded testnet mnemonic>> QORE_SECRET_FILE=<scratch json> node scripts/delta-run.mjs --n 5
await import('../contracts-v4/script/delta-run.mjs');
