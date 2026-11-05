import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';

import base from './vite.config';

/** Builds only the home page showcase (real App pages with bundled demo data). */
export default mergeConfig(
  base,
  defineConfig({
    base: '/home-showcase/',
    build: {
      outDir: '../../public/home-showcase',
      emptyOutDir: true,
      rollupOptions: {
        input: fileURLToPath(new URL('./home-showcase.html', import.meta.url)),
      },
    },
  }),
);
