import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const runtimeRoot = dirname(createRequire(import.meta.url).resolve('pyodide/package.json'));
const files = new Map([
  ['pyodide.mjs', 'application/javascript'],
  ['pyodide.asm.js', 'application/javascript'],
  ['pyodide.asm.wasm', 'application/wasm'],
  ['python_stdlib.zip', 'application/zip'],
  ['pyodide-lock.json', 'application/json'],
]);

/** Serve and package the installed, pinned runtime; no CDN is needed to run code. */
export function pythonRuntimePlugin(): Plugin {
  return {
    name: 'syntara-python-runtime',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const prefix = `${server.config.base}python-runtime/`;
        const url = request.url?.split('?')[0] ?? '';
        const file = url.startsWith(prefix) ? url.slice(prefix.length) : '';
        const type = files.get(file);
        if (!type) return next();
        response.setHeader('Content-Type', type);
        const stream = createReadStream(join(runtimeRoot, file));
        stream.on('error', () => {
          response.statusCode = 500;
          response.end('Python runtime unavailable');
        });
        stream.pipe(response);
      });
    },
    generateBundle() {
      files.forEach((_, file) => {
        this.emitFile({
          type: 'asset',
          fileName: `python-runtime/${file}`,
          source: readFileSync(join(runtimeRoot, file)),
        });
      });
    },
  };
}
