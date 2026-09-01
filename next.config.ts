import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // App Router Strict Mode replays mount effects in development. That doubles
  // every authenticated /learn request against the remote Railway database and
  // makes localhost substantially slower than production.
  reactStrictMode: false,
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: ['@napi-rs/canvas'],
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
    '/*': [
      './node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**/*',
      './node_modules/.pnpm/@fontsource+noto-sans-sc*/node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2',
      './lib/generation/prompts/**/*.md',
    ],
  },
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
