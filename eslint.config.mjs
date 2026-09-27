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
            'Nothing secret lives in localStorage. The device record lives in IndexedDB through ' +
            'src/lib/device. See src/lib/device/README.md.',
        },
        {
          name: 'indexedDB',
          message:
            'IndexedDB holds exactly two things: this device record (src/lib/device/store.ts) and ' +
            'unfinished upload handles (src/lib/files/handles.ts). A new use needs an argument ' +
            'in its README and an exemption in eslint.config.mjs.',
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
            property: 'indexedDB',
            message:
              `${object}.indexedDB is the same store as the bare global. Only the exempt modules ` +
              'in eslint.config.mjs may reach it.',
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

  // The one localStorage exemption: src/lib/app/icon-size.ts persists one
  // of four literal words naming how large the drive's icons are drawn. It is a
  // view preference with no bearing on secrets, and losing it on every reload is
  // the kind of small wrongness a user notices on every visit.
  {
    files: ['src/lib/app/icon-size.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },

  // IndexedDB: the device record (src/lib/device/store.ts) holds
  // this browser's non-extractable CryptoKeys, which only IndexedDB can store,
  // and its PIN-sealed material. src/lib/files/handles.ts keeps one
  // FileSystemFileHandle per unfinished upload.
  // store.ts also reaches localStorage, to delete the PIN-wrapped seed an
  // earlier deployment left in browsers that ran it. It only removes; it never
  // reads or writes. See src/lib/device/README.md.
  {
    files: ['src/lib/device/store.ts', 'src/lib/files/handles.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },

  // next/image optimises by fetching the source on the server. A drive thumbnail
  // is a blob: URL of bytes decrypted in this tab, which no server can fetch and
  // none may see, so <img> is the only option here rather than the lazy one.
  {
    files: ['src/components/drive/DriveScreen.tsx'],
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
