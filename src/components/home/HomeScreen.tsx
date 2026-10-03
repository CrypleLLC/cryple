'use client';

import { useZekke } from '@/components/session/ZekkeProvider';
import { useShellNavigation } from '@/components/shell/ShellNavigation';
import HomeStorage from './HomeStorage';

export default function HomeScreen() {
  const { holds } = useZekke();

  return (
    <div className="space-y-10">
      {holds('files') ? <HomeStorage /> : null}
      <AppIcons />
    </div>
  );
}

function AppIcons() {
  const { destinations, open } = useShellNavigation();

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] sm:gap-y-9">
      {destinations.map(({ id, label, description, appIcon: AppIcon }) => (
        <li key={id} className="flex justify-center">
          <button
            type="button"
            onClick={() => open(id)}
            title={description}
            className="group flex w-full flex-col items-center gap-2.5 rounded-2xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-[22%] bg-surface p-3 shadow-card ring-1 ring-line transition duration-150 group-hover:-translate-y-0.5 group-hover:shadow-lift group-hover:ring-brand-200 group-active:translate-y-0 group-active:scale-95 sm:h-20 sm:w-20 sm:p-4">
              <AppIcon />
            </span>
            <span className="text-compact font-medium text-ink">{label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
