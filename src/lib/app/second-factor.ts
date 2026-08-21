import { checkMnemonic, checkPin, MODE_COPY } from './onboarding';

export const SECOND_FACTOR_COPY = {
  offered: {
    title: 'Turn on PIN protection',
    summary:
      'Requires your PIN to sign in, on top of your recovery phrase. Someone who steals your ' +
      'phrase then still cannot get in, and you will be asked for the PIN on every new device.',
    phrasePrompt:
      'Confirm your recovery phrase, and set the PIN you want. The phrase is what re-encrypts ' +
      'the copy kept on this device under the new PIN.',
    oneWayDoor: MODE_COPY.oneWayDoor,
  },
  enabled: {
    title: 'PIN protection is on',
    summary:
      'Signing in needs your PIN as well as your recovery phrase, on this device and on any ' +
      'other.',
    oneWayDoor: MODE_COPY.oneWayDoor,
  },
  phraseMismatch:
    'That recovery phrase belongs to a different account. Check it against the one you signed ' +
    'in with.',
  enabledNotice:
    'PIN protection is on. Your PIN is now required to sign in anywhere, not just to unlock this ' +
    'device.',
} as const;

export type UpgradeCheck = { ok: true } | { ok: false; message: string };

export function checkUpgrade(
  mnemonic: string,
  pin: string,
  confirmation: string,
): UpgradeCheck {
  const phrase = checkMnemonic(mnemonic);
  if (!phrase.ok) {
    return { ok: false, message: phrase.message };
  }
  return checkPin(pin, confirmation);
}
