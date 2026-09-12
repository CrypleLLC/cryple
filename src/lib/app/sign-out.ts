export type SessionExitId = 'lock' | 'log-out';

export interface SessionExit {
  id: SessionExitId;
  label: string;
  description: string;
  destructive: boolean;
  confirm?: string;
}

const LOCK: SessionExit = {
  id: 'lock',
  label: 'Lock',
  description: 'Ends this session. Your PIN brings you straight back.',
  destructive: false,
};

const LOG_OUT_ERASING_DEVICE: SessionExit = {
  id: 'log-out',
  label: 'Log out',
  description: "Ends this session and removes this device's copy of your recovery phrase.",
  destructive: true,
  confirm:
    'Log out and erase this device? You will need your recovery phrase to get back in — ' +
    'nobody can issue you another. Your vault itself is untouched.',
};

const LOG_OUT_NOTHING_STORED: SessionExit = {
  id: 'log-out',
  label: 'Log out',
  description: 'Ends this session. You enter your recovery phrase again to come back.',
  destructive: false,
};

export function sessionExits(deviceRemembersPhrase: boolean): SessionExit[] {
  return deviceRemembersPhrase ? [LOCK, LOG_OUT_ERASING_DEVICE] : [LOG_OUT_NOTHING_STORED];
}

export function lockExit(exits: readonly SessionExit[]): SessionExit | undefined {
  return exits.find((exit) => exit.id === 'lock');
}

export function logOutExit(exits: readonly SessionExit[]): SessionExit {
  const found = exits.find((exit) => exit.id === 'log-out');
  if (found === undefined) {
    throw new Error('there is always a way out of a session');
  }

  return found;
}
