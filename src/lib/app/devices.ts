import type { DeviceRecordOnServer } from '@/lib/keyrings/api';
import { KEYRING_SCOPES, parseScopeList, type Scope } from '@/lib/scopes';

export const DEVICES_COPY = {
  title: 'Devices',
  summary:
    'Every browser and app that holds keys to this account. The server stores no names: the ' +
    'names below are sealed in your address book.',
  thisDevice: 'This device',
  unnamed: 'Unnamed device',
  full: 'Full device',
  limited: 'Limited device',
  rename: 'Rename',
  save: 'Save',
  remove: 'Remove',
  removeTitle: 'Remove a device',
  removeWarning:
    'Removing a device changes every key it held, so it cannot read anything saved from then ' +
    'on. It keeps whatever it already copied: removal cannot reach into it.',
  removePhrase:
    'Removing another device re-keys everything it could open, and the new keys are sealed for ' +
    'your recovery phrase too. Type your phrase for this one change; this browser forgets it ' +
    'straight away.',
  removeSubmit: 'Remove it',
  removing: 'Removing…',
  removed: 'The device was removed. Every key it held has changed.',
  chainVerified: 'Every change to your devices verifies from your recovery phrase’s key.',
  chainBroken:
    'The history of your devices that the server returned does not verify from your ' +
    'recovery phrase’s key. Someone may have tampered with it. Do not trust the list below, ' +
    'and add no device until this is resolved.',
  lostDevicesTitle: 'I lost my devices',
  lostDevicesSummary:
    'Adds this browser with your recovery phrase and removes every other device in the same ' +
    'step, re-keying everything they held. Use it when a device was lost or stolen.',
  tooMany:
    'Your account already has as many devices as it can hold. Choose which ones to remove to ' +
    'make room for this browser.',
} as const;

export interface DeviceRow {
  id: string;
  name: string;
  isThisDevice: boolean;
  full: boolean;
  scopes: Scope[];
  createdAt: string;
}

const SCOPE_LABELS: Record<Scope, string> = {
  admin: 'Manage devices',
  passwords: 'Passwords',
  secrets: 'Vault',
  notes: 'Notes',
  documents: 'Documents',
  files: 'Drive',
  sharing: 'Sharing',
};

export function scopeLabel(scope: Scope): string {
  return SCOPE_LABELS[scope];
}

export function describeScopes(scopes: readonly Scope[]): string {
  if (KEYRING_SCOPES.every((scope) => scopes.includes(scope)) && scopes.includes('admin')) {
    return 'Everything';
  }
  return scopes.map(scopeLabel).join(', ');
}

export function deviceRows(
  devices: readonly DeviceRecordOnServer[],
  names: Readonly<Record<string, { name: string } | undefined>>,
  thisDeviceId: string,
): DeviceRow[] {
  return devices
    .map((device) => {
      const scopes = parseScopeList(device.scopes);
      const named = names[device.id]?.name.trim();
      return {
        id: device.id,
        name:
          named !== undefined && named !== ''
            ? named
            : device.id === thisDeviceId
              ? DEVICES_COPY.thisDevice
              : DEVICES_COPY.unnamed,
        isThisDevice: device.id === thisDeviceId,
        full: scopes.includes('admin'),
        scopes,
        createdAt: device.created_at,
      };
    })
    .sort((a, b) => {
      if (a.isThisDevice !== b.isThisDevice) {
        return a.isThisDevice ? -1 : 1;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
}
