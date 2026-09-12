'use client';

import { useState } from 'react';
import { ACCOUNT_MENU_COPY, SETTINGS_TABS, type SettingsTabId } from '@/lib/app';
import SecurityScreen from './SecurityScreen';
import SharingScreen from './SharingScreen';
import { Modal } from './ui';

const PANELS: Record<SettingsTabId, () => React.JSX.Element> = {
  sharing: SharingScreen,
  security: SecurityScreen,
};

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTabId>('sharing');
  const Panel = PANELS[tab];

  return (
    <Modal
      title={ACCOUNT_MENU_COPY.settingsTitle}
      subtitle={ACCOUNT_MENU_COPY.settingsSubtitle}
      onClose={onClose}
      wide
    >
      <div className="space-y-5">
        <div role="tablist" aria-label={ACCOUNT_MENU_COPY.settingsTitle} className="flex gap-1">
          {SETTINGS_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`rounded-lg px-3 py-2 text-compact font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                tab === entry.id
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-ink-soft hover:bg-raised hover:text-ink'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div role="tabpanel">
          <Panel />
        </div>
      </div>
    </Modal>
  );
}
