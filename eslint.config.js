import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // vite-plugin-pwa dev service-worker output (devOptions.enabled) — generated, git-ignored.
      '**/dev-dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '.claude/**',
      // Standalone Node tooling scripts (design gate, etc.) — not part of the TS app.
      'scripts/**',
      // Design-system assets from Claude Design — not linted as app source.
      'design/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript (with @types/node) checks undefined identifiers far more accurately than the
      // lexical no-undef rule, which false-positives on Node globals. typescript-eslint recommends
      // disabling it outright.
      'no-undef': 'off',
      // CLAUDE.md non-negotiable: no `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Non-null assertions need a comment explaining why (enforced by review, not lint);
      // ban the silent ones.
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
  {
    // Sprint 3 task 1: tokens are the single source of colour. No hex literal may appear in a till
    // component file — colours are read as `var(--color-*)` from the generated theme. The generated
    // token modules are the one exception (theme/ holds the source values).
    files: ['apps/till/src/**/*.{ts,tsx}'],
    ignores: ['apps/till/src/theme/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}/]',
          message:
            'No hardcoded colours in the till — use a CSS custom property from src/theme/tokens.css (Sprint 3 task 1).',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
