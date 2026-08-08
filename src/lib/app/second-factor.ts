import { checkMnemonic, checkPin, MODE_COPY } from './onboarding';

export const SECOND_FACTOR_COPY = {
  offered: {
    title: 'Turn on PIN protection',
    summary:
      'Adds a 6-digit PIN to this account. You will need it alongside your recovery phrase to ' +
      'sign in, and it encrypts a copy of your phrase on this device — so day to day you lock ' +
      'and unlock with six digits instead of typing your phrase again.',
    phrasePrompt:
      'Confirm your recovery phrase. This device does not keep one yet, and your new PIN is what ' +
      'will encrypt it.',
    oneWayDoor: MODE_COPY.oneWayDoor,
  },
  enabled: {
    title: 'PIN protection is on',
    summary:
      'Signing in needs your PIN as well as your recovery phrase, and this device keeps your ' +
      'phrase encrypted under that PIN.',
    oneWayDoor: MODE_COPY.oneWayDoor,
  },
  phraseMismatch:
    'That recovery phrase belongs to a different account. Check it against the one you signed ' +
    'in with.',
  enabledNotice:
    'PIN protection is on. This device now remembers your recovery phrase, encrypted under your ' +
    'PIN — you can lock instead of logging out.',
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
