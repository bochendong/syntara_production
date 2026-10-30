import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // App Router Strict Mode replays mount effects in development. That doubles
  // every authenticated /learn request against the remote Railway database and
  // makes localhost substantially slower than production.
  reactStrictMode: false,
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: ['@napi-rs/canvas', 'pyodide'],
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, '');
        }),
      );
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        'node:assert': false,
        'node:crypto': false,
        'node:fs': false,
        'node:path': false,
        'node:stream': false,
        'node:zlib': false,
      };
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        assert: false,
        crypto: false,
        fs: false,
        path: false,
        stream: false,
        zlib: false,
      };
    }
    return config;
  },
  outputFileTracingExcludes: {
    '/*': ['./assets/**/*', './OpenMAIC-org/**/*', './public/generated-notebooks/**/*'],
  },
  outputFileTracingIncludes: {
    '/api/native/v1/import-docs/*': [
      './docs/api/ai-course-problem-upload.md',
      './docs/api/course-problem-import-transport.md',
      './docs/api/problem-import-agent-blind-test.md',
      './docs/api/problem-import-cross-subject-blind-test.md',
      './docs/api/problem-import-frozen-holdout.md',
    ],
    // The Python fallback loads its WASM and standard library inside a worker;
    // those files are not visible to Next's static dependency tracing.
    '/api/courses/*/problems': ['./node_modules/pyodide/*'],
    '/api/courses/*/problems/**': ['./node_modules/pyodide/*'],
    '/api/notebooks/*/problems': ['./node_modules/pyodide/*'],
    '/api/notebooks/*/problems/**': ['./node_modules/pyodide/*'],
    '/api/teacher/courses/*/sources/*/process': ['./node_modules/pyodide/*'],
    '/api/quiz-code-run': ['./node_modules/pyodide/*'],
    '/api/native/v1/course-code-preflight': ['./node_modules/pyodide/*'],
    '/*': [
      './node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**/*',
      './node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2',
      './lib/generation/prompts/**/*.md',
    ],
  },
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
