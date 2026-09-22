export const SETTINGS_TABS = [
  { id: 'sharing', label: 'Sharing' },
  { id: 'devices', label: 'Devices' },
  { id: 'username', label: 'Username' },
  { id: 'pin', label: 'PIN' },
  { id: 'account', label: 'Account' },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

export const ACCOUNT_MENU_COPY = {
  open: 'Account menu',
  settings: 'Settings',
  settingsTitle: 'Settings',
  settingsSubtitle:
    'Who you are connected to, your devices, and how your recovery phrase and PINs protect this account.',
} as const;

export const ACCOUNT_COPY = {
  deleteTitle: 'Delete this account',
  deleteSummary:
    'Deletes every device, key, item, connection and share. It needs your recovery phrase, so a ' +
    'stolen device alone can never do it.',
  deleteWarning:
    'This cannot be undone, by you or by anyone at Cryple. Everything shared with others stops ' +
    'opening for them too.',
  phraseHint:
    'Your recovery phrase signs the deletion. This browser forgets it as soon as the request is sent.',
  confirm: 'I understand that my account and everything in it will be gone for good.',
  deleteSubmit: 'Delete my account',
  deleting: 'Deleting…',
  limitedDevice:
    'This device cannot delete the account. Use a full device, with your recovery phrase.',
} as const;

export function isSettingsTab(value: string): value is SettingsTabId {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}
