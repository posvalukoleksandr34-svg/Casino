import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Module boundaries (see docs/architecture.md):
 *   src/engine   pure game maths + RNG — no framework, server, DB or UI imports, no Math.random
 *   src/server   domain services — never imports UI or app routes
 *   components   presentation — never imports server-only modules
 */
export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts', '*.config.*'] },
  ...tseslint.configs.recommended,
  {
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the provably fair RandomSource or node:crypto.' }],
    },
  },
  {
    files: ['src/engine/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/server/*', '@/app/*', '@/components/*', '@/lib/*', 'next', 'next/*', 'react', 'react-dom', 'pg', 'drizzle-orm', 'drizzle-orm/*', 'node:*'], message: 'The game engine must stay pure and framework-free.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@/components/*', '@/app/*', '@/lib/api'], message: 'Server modules must not depend on presentation code.' }] }],
    },
  },
  {
    files: ['src/components/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@/server/*'], message: 'Client components must not import server modules; pass data as props or call the API.' }] }],
    },
  },
  {
    files: ['src/components/games/**', 'src/components/admin/charts.tsx'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['tests/**', 'scripts/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
