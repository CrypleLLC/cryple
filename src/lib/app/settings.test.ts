import { describe, expect, it } from 'vitest';
import { isSettingsTab, SETTINGS_TABS } from './settings';
import { lockExit, logOutExit, sessionExits } from './sign-out';

describe('the settings tabs', () => {
  it('opens on sharing, then splits signing in into the two things you can change', () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual(['sharing', 'username', 'pin']);
  });

  it('recognises only its own tab ids', () => {
    expect(isSettingsTab('pin')).toBe(true);
    expect(isSettingsTab('username')).toBe(true);
    expect(isSettingsTab('security')).toBe(false);
    expect(isSettingsTab('vault')).toBe(false);
  });
});

describe('splitting the session exits between the header and the menu', () => {
  it('offers a lock in the header only when the device remembers the phrase', () => {
    expect(lockExit(sessionExits(true))?.id).toBe('lock');
    expect(lockExit(sessionExits(false))).toBeUndefined();
  });

  it('always finds a way out, whichever shape the account is in', () => {
    expect(logOutExit(sessionExits(true)).destructive).toBe(true);
    expect(logOutExit(sessionExits(false)).destructive).toBe(false);
  });
});
