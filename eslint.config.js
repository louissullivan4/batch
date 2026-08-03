import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
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
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
