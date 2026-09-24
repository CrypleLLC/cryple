import { describe, expect, it } from 'vitest';
import { isSettingsTab, SETTINGS_TABS } from './settings';
import { lockExit, removeBrowserExit, sessionExits } from './sign-out';

describe('the settings tabs', () => {
  it('opens on sharing, then devices, then how this account is protected', () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      'sharing',
      'devices',
      'username',
      'pin',
      'account',
    ]);
  });

  it('recognises only its own tab ids', () => {
    expect(isSettingsTab('pin')).toBe(true);
    expect(isSettingsTab('devices')).toBe(true);
    expect(isSettingsTab('security')).toBe(false);
    expect(isSettingsTab('vault')).toBe(false);
  });
});

describe('splitting the session exits between the header and the menu', () => {
  it('always offers a lock, because the device record survives it', () => {
    expect(lockExit(sessionExits())?.id).toBe('lock');
  });

  it('always offers removing this browser, and confirms it first', () => {
    const remove = removeBrowserExit(sessionExits());
    expect(remove.destructive).toBe(true);
    expect(remove.confirm).toBeDefined();
  });
});
