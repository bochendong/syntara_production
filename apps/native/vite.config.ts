import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBuildRevision } from '../../lib/version/source-revision';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { pythonRuntimePlugin } from './python-runtime-plugin';
import { handwritingGradingPlugin } from './handwriting-grading-plugin.mjs';
import { previewChatPlugin } from './preview-chat-plugin.mjs';
import { stagingPreviewPlugin } from './staging-preview-plugin.mjs';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  define: {
    'import.meta.env.VITE_SYNTARA_REVISION': JSON.stringify(
      readBuildRevision(fileURLToPath(new URL('../../', import.meta.url))) ||
        execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ),
  },
  plugins: [
    react(),
    tailwindcss(),
    pythonRuntimePlugin(),
    handwritingGradingPlugin(),
    previewChatPlugin(),
    stagingPreviewPlugin(),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
