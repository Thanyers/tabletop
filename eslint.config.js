import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Kept deliberately small: typecheck (`npm run typecheck`) owns type errors,
// this file owns the rules tsc cannot enforce. Rule rationale: CONTRIBUTING.md#lint
export default tseslint.config(
  {
    ignores: [
      'dist/', 'worker-build/', '.wrangler/', 'test-results/', 'playwright-report/',
      'server/.data/', 'public/', 'docs/', 'handoff/', '.claude/',
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // `strict` only blocks implicit any; this blocks the explicit kind.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
        minimumDescriptionLength: 10,
      }],
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Sanitizers strip control characters on purpose.
      'no-control-regex': 'off',
      // Existing findings when lint was introduced. Each is a warning until the
      // backlog is cleared, then promoted to error (spec.md → ถัดไป).
      'no-useless-assignment': 'warn',
      'no-empty': 'warn',
      'preserve-caught-error': 'warn',
      'no-extra-boolean-cast': 'warn',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      'no-cond-assign': 'warn',
      'no-unsafe-finally': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/no-unsafe-declaration-merging': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // These return early before their hooks (spec.md → ถัดไป). New files stay strict.
    files: [
      'src/tabletop/ui/EncounterWorkbench.tsx',
      'src/tabletop/ui/InvoiceWorkbench.tsx',
      'src/tabletop/ui/TeachingWorkbench.tsx',
    ],
    rules: { 'react-hooks/rules-of-hooks': 'warn' },
  },
  {
    files: ['cloudflare/**/*.ts'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // Playwright callbacks passed to page.evaluate() run in the browser.
    files: ['tests/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
