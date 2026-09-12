import { describe, expect, it } from 'vitest';
import { isSettingsTab, SETTINGS_TABS } from './settings';
import { lockExit, logOutExit, sessionExits } from './sign-out';

describe('the settings tabs', () => {
  it('opens on sharing, and holds both screens that left the sidebar', () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual(['sharing', 'security']);
  });

  it('recognises only its own tab ids', () => {
    expect(isSettingsTab('security')).toBe(true);
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
