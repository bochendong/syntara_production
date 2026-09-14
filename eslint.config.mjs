import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Vendored/generated code:
    'packages/**',
    // Claude Code local files:
    '.claude/**',
    '.superpowers/**',
    '.worktrees/**',
  ]),
  {
    rules: {
      // Dynamic AI-generated image URLs from various providers are incompatible
      // with next/image (requires known dimensions and whitelisted domains).
      '@next/next/no-img-element': 'off',
      // Allow unused vars/args prefixed with _ (common convention for intentionally
      // unused destructured values, callback params, etc.)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['{app,components,features,lib}/**/*.{ts,tsx}'],
    ignores: ['lib/notifications/client-toast.ts', 'app/notification-compare-test/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='alert'], CallExpression[callee.object.name='window'][callee.property.name='alert']",
          message: 'Use the shared lightweight toast from @/lib/notifications/client-toast.',
        },
        {
          selector: "CallExpression[callee.object.name='toast'][callee.property.name='custom']",
          message: 'Use standard toast variants to preserve the global notification appearance.',
        },
        {
          selector:
            "ImportDeclaration[source.value='sonner'] ImportSpecifier[imported.name='toast']",
          message: 'Import toast from @/lib/notifications/client-toast.',
        },
        {
          selector: "ImportDeclaration ImportSpecifier[imported.name='NotificationBannerCard']",
          message: 'Legacy notification cards are preview-only; use the shared lightweight toast.',
        },
      ],
    },
  },
  {
    files: ['lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/components/**'],
              message:
                'Keep lib free of React UI dependencies. Move UI helpers to components, or expose pure data/functions from lib.',
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
