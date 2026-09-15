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

      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) => [
          {
            object,
            property: 'localStorage',
            message:
              `${object}.localStorage is the same persistent store as the bare global, and ` +
              'no-restricted-globals cannot see it. Only the exempt modules in eslint.config.mjs ' +
              'may reach it.',
          },
          {
            object,
            property: 'sessionStorage',
            message:
              `Nothing in Cryple is persisted to sessionStorage, through ${object} or otherwise. ` +
              'See src/lib/session/README.md.',
          },
        ]),
      ],
    },
  },

  // The third exemption, added 2026-09-11: src/lib/app/icon-size.ts persists one
  // of four literal words naming how large the drive's icons are drawn. It is a
  // view preference with no bearing on secrets, and losing it on every reload is
  // the kind of small wrongness a user notices on every visit.
  //
  // The fourth, added 2026-09-13: src/lib/sharing/pins.ts keeps the key
  // fingerprint pinned when each sharing connection was accepted, so a later
  // change raises the alarm. It stores one blob sealed under a DEK wrapped by the
  // vault KEK, the same construction as a vault item, so the device holds no
  // readable list of whom the account is connected to. The server has no
  // encrypted slot per connection to hold it instead; that arrives with the
  // connection nicknames (Task 104.5), and the pins move there with them.
  {
    files: [
      'src/lib/pin/**',
      'src/lib/app/mode-hint.ts',
      'src/lib/app/icon-size.ts',
      'src/lib/sharing/pins.ts',
    ],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
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
