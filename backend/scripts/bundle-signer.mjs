// Bundles src/sponsorSigner.ts and its @qorechain/sdk + @cosmjs deps into vendor/sponsor-signer.mjs (see that file's header).
import { build } from 'esbuild';
await build({
  entryPoints: ['src/sponsorSigner.ts'], outfile: 'vendor/sponsor-signer.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node20', minify: true, legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
