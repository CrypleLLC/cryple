'use client';

import { useState } from 'react';
import { ACCOUNT_MENU_COPY, SETTINGS_TABS, type SettingsTabId } from '@/lib/app';
import { useCryple } from './CrypleProvider';
import AccountScreen from './AccountScreen';
import DevicesScreen from './DevicesScreen';
import PinScreen from './PinScreen';
import SharingScreen from './SharingScreen';
import UsernameScreen from './UsernameScreen';
import { Modal } from './ui';

const PANELS: Record<SettingsTabId, () => React.JSX.Element> = {
  sharing: SharingScreen,
  devices: DevicesScreen,
  username: UsernameScreen,
  pin: PinScreen,
  account: AccountScreen,
};

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { holds } = useCryple();
  const tabs = SETTINGS_TABS.filter((entry) => entry.id !== 'sharing' || holds('sharing'));
  const [tab, setTab] = useState<SettingsTabId>(tabs[0].id);
  const Panel = PANELS[tab];

  return (
    <Modal
      title={ACCOUNT_MENU_COPY.settingsTitle}
      subtitle={ACCOUNT_MENU_COPY.settingsSubtitle}
      onClose={onClose}
      wide
    >
      <div className="flex flex-col gap-5 sm:h-[40rem] sm:flex-row sm:gap-6">
        <div
          role="tablist"
          aria-label={ACCOUNT_MENU_COPY.settingsTitle}
          className="flex shrink-0 gap-1 sm:w-44 sm:flex-col sm:border-r sm:border-line sm:pr-5"
        >
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`rounded-lg px-3 py-2 text-compact font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:w-full sm:text-left ${
                tab === entry.id
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-ink-soft hover:bg-raised hover:text-ink'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="min-w-0 flex-1 sm:overflow-y-auto">
          <Panel />
        </div>
      </div>
    </Modal>
  );
}
