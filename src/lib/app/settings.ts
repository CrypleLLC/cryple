export const SETTINGS_TABS = [
  { id: 'sharing', label: 'Sharing' },
  { id: 'security', label: 'Security' },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

export const ACCOUNT_MENU_COPY = {
  open: 'Account menu',
  settings: 'Settings',
  settingsTitle: 'Settings',
  settingsSubtitle: 'Who you are connected to, and how signing in to this account works.',
} as const;

export function isSettingsTab(value: string): value is SettingsTabId {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}
