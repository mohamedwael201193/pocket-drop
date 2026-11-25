import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // Function form, so Vite's tiny preload helper gets its own chunk instead of being absorbed into the viem chunk
        // (with the object form the landing and the entry had to download viem just to lazy-load anything).
        manualChunks(id) {
          if (id.includes('vite/preload-helper')) return 'preload';
          if (!id.includes('/node_modules/')) return undefined;
          if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|@remix-run\/router|scheduler)\//.test(id)) return 'react';
          if (/\/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion';
          if (/\/node_modules\/(viem)\//.test(id)) return 'viem';
          return undefined;
        },
      },
    },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 60_000 },
});
