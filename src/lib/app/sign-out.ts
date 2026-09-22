export type SessionExitId = 'lock' | 'remove-browser';

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
  description:
    'Forgets the keys this tab holds. This browser stays one of your devices, and your PIN ' +
    'brings you back.',
  destructive: false,
};

const REMOVE_BROWSER: SessionExit = {
  id: 'remove-browser',
  label: 'Remove this browser',
  description:
    'Takes this browser off your account’s devices. Coming back needs your recovery phrase.',
  destructive: true,
  confirm:
    'Remove this browser from your account? It forgets every key it holds, and the server stops ' +
    'accepting it at once. To come back you type your recovery phrase, and nobody can issue you ' +
    'another. Your vault itself is untouched.',
};

export function sessionExits(): SessionExit[] {
  return [LOCK, REMOVE_BROWSER];
}

export function lockExit(exits: readonly SessionExit[]): SessionExit | undefined {
  return exits.find((exit) => exit.id === 'lock');
}

export function removeBrowserExit(exits: readonly SessionExit[]): SessionExit {
  const found = exits.find((exit) => exit.id === 'remove-browser');
  if (found === undefined) {
    throw new Error('there is always a way to remove this browser');
  }
  return found;
}
