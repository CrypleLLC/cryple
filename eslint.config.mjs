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

  // The third exemption, added 2026-09-11: src/lib/app/icon-size.ts persists one
  // of four literal words naming how large the drive's icons are drawn. It is a
  // view preference with no bearing on secrets, and losing it on every reload is
  // the kind of small wrongness a user notices on every visit.
  {
    files: ['src/lib/pin/**', 'src/lib/app/mode-hint.ts', 'src/lib/app/icon-size.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  // next/image optimises by fetching the source on the server. A drive thumbnail
  // is a blob: URL of bytes decrypted in this tab, which no server can fetch and
  // none may see, so <img> is the only option here rather than the lazy one.
  {
    files: ['src/components/DriveScreen.tsx'],
    rules: {
      '@next/next/no-img-element': 'off',
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
