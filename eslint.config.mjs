import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'tsconfig.tsbuildinfo'],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  {
    rules: {
      'no-console': 'error',

      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            'Only the seed vault may reach persistent storage, and it stores one PIN-encrypted ' +
            'blob. Go through src/lib/pin instead. See src/lib/pin/README.md.',
        },
        {
          name: 'sessionStorage',
          message:
            'Nothing in Cryple is persisted to sessionStorage. Session key material is held in ' +
            'memory by SessionKeystore. See src/lib/session/README.md.',
        },
      ],
    },
  },

  {
    files: ['src/lib/pin/**', 'src/lib/app/mode-hint.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  {
    files: ['scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];

export default config;
