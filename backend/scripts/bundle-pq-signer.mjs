// Bundles src/pqSignerHandler.ts (and @qorechain/sdk, @noble, cosmjs-types) into ../signer/api/pq-sign.mjs: the isolated
// ML-DSA-87 relay signer, deployed as its own Vercel project with only RELAYER_PQC_SEED (see signer/README.md).
import { build } from 'esbuild';
await build({
  entryPoints: ['src/pqSignerHandler.ts'], outfile: '../signer/api/pq-sign.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node20', minify: true, legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
