import { checkMnemonic, checkPin } from './onboarding';

export const PARANOID_ONE_WAY_DOOR =
  'Before you turn it on: there is no way back to Standard, and no reset. If you forget your ' +
  'account PIN, your account is lost for ever, even with your recovery phrase. Standard is a ' +
  'deliberate choice, not a lesser one: with it, your recovery phrase alone is always enough.';

export const SECOND_FACTOR_COPY = {
  offered: {
    title: 'Turn on Paranoid mode',
    summary:
      'Adds an account PIN to everything your recovery phrase alone could do: adding a device, ' +
      'deleting the account, changing this PIN. Someone who steals your phrase then still cannot ' +
      'add a device of their own.',
    phrasePrompt:
      'Your recovery phrase signs this change. This browser does not keep it, so type it here; ' +
      'it is forgotten as soon as the change is made.',
    pinHint:
      'This is your account PIN. It can be the same six digits as this browser’s PIN, but it is ' +
      'asked for separately, whenever your recovery phrase is used.',
    oneWayDoor: PARANOID_ONE_WAY_DOOR,
    submit: 'Turn on Paranoid mode',
    submitting: 'Turning it on…',
  },
  enabled: {
    title: 'Paranoid mode is on',
    summary:
      'Adding a device, deleting the account and changing the account PIN need your account PIN ' +
      'as well as your recovery phrase.',
    oneWayDoor:
      'There is no way back to Standard, and no reset. A forgotten account PIN ends the account.',
  },
  rotate: {
    title: 'Change the account PIN',
    summary:
      'Needs your recovery phrase, your current account PIN and the new one. Your recovery ' +
      'phrase alone can never replace a PIN that is set.',
    submit: 'Change the account PIN',
    submitting: 'Changing it…',
    done: 'Your account PIN has changed.',
  },
  phraseMismatch:
    'That recovery phrase belongs to a different account. Check it against the one this browser ' +
    'belongs to.',
  enabledNotice:
    'Paranoid mode is on. Your account PIN is now needed whenever your recovery phrase is used.',
  enabledButUnconfirmed:
    'The answer did not arrive, so it is not certain Paranoid mode is on. It was checked: ',
} as const;

export const ACCOUNT_PIN_REFUSED =
  'That did not work. Nothing was changed. If you are sure of your account PIN, wait a few ' +
  'minutes before trying again: after several wrong tries the server stops evaluating it for a ' +
  'while, so an immediate retry cannot succeed and still counts as a try.';

export function accountPinRefusal(consecutiveFailures: number): string {
  return consecutiveFailures >= 2
    ? ACCOUNT_PIN_REFUSED
    : 'That did not work. Nothing was changed. Check your recovery phrase and account PIN.';
}

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
