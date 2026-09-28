'use client';

import { useId, type ReactNode } from 'react';

const WHITE = 'var(--color-surface)';

function FeatureArt({ children }: { children: (fill: string) => ReactNode }) {
  const id = `feature-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" fill="none" className="h-full w-full">
      <defs>
        <linearGradient id={id} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--color-brand-700)" />
          <stop offset="1" stopColor="var(--color-accent-400)" />
        </linearGradient>
      </defs>
      {children(`url(#${id})`)}
    </svg>
  );
}

export function SecretsFeatureIcon() {
  return (
    <FeatureArt>
      {(fill) => (
        <>
          <circle cx="32" cy="21" r="12" fill={fill} />
          <circle cx="32" cy="21" r="4.5" fill={WHITE} />
          <rect x="29" y="30" width="6" height="25" rx="3" fill={fill} />
          <rect x="35" y="38.5" width="9" height="5" rx="2.5" fill={fill} />
          <rect x="35" y="45.5" width="6" height="5" rx="2.5" fill={fill} />
        </>
      )}
    </FeatureArt>
  );
}

export function PasswordsFeatureIcon() {
  return (
    <FeatureArt>
      {(fill) => (
        <>
          <rect x="8" y="14" width="48" height="36" rx="7" fill={fill} />
          <circle cx="21" cy="27" r="4.5" stroke={WHITE} strokeWidth={2.5} />
          <path d="M25.5 27h16M37 27v4.5" stroke={WHITE} strokeWidth={2.5} strokeLinecap="round" />
          <circle cx="19" cy="40" r="2.8" fill={WHITE} />
          <circle cx="28" cy="40" r="2.8" fill={WHITE} />
          <circle cx="37" cy="40" r="2.8" fill={WHITE} />
          <circle cx="46" cy="40" r="2.8" fill={WHITE} />
        </>
      )}
    </FeatureArt>
  );
}

export function NotesFeatureIcon() {
  return (
    <FeatureArt>
      {(fill) => (
        <>
          <path d="M14 12a4 4 0 0 1 4-4h20l12 12v32a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V12z" fill={fill} />
          <path d="M38 8l12 12H42a4 4 0 0 1-4-4V8z" fill={WHITE} />
          <path d="M22 32h20M22 40h20M22 48h12" stroke={WHITE} strokeWidth={2.5} strokeLinecap="round" />
        </>
      )}
    </FeatureArt>
  );
}

export function DocumentsFeatureIcon() {
  return (
    <FeatureArt>
      {(fill) => (
        <>
          <rect x="22" y="8" width="30" height="40" rx="4" fill={fill} />
          <rect x="12" y="16" width="30" height="40" rx="4" fill={fill} stroke={WHITE} strokeWidth={3} />
          <path d="M20 30h14M20 38h14M20 46h9" stroke={WHITE} strokeWidth={2.5} strokeLinecap="round" />
        </>
      )}
    </FeatureArt>
  );
}

export function DriveFeatureIcon() {
  return (
    <FeatureArt>
      {(fill) => (
        <>
          <path d="M18 46A9 9 0 0 1 18.6 28.1 13 13 0 0 1 42.5 24.6 11 11 0 0 1 46 46Z" fill={fill} />
          <path d="M32 44V32" stroke={WHITE} strokeWidth={2.5} strokeLinecap="round" />
          <path
            d="M26.5 37.5 32 32l5.5 5.5"
            stroke={WHITE}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </FeatureArt>
  );
}

export function SharingFeatureIcon() {
  return (
    <FeatureArt>
      {(fill) => (
        <>
          <circle cx="14" cy="44" r="8" fill={fill} />
          <circle cx="50" cy="44" r="8" fill={fill} />
          <path d="M26 34l-6 4M38 34l6 4" stroke={fill} strokeWidth={3} strokeLinecap="round" />
          <path d="M27 20v-4a5 5 0 0 1 10 0v4" stroke={fill} strokeWidth={3} strokeLinecap="round" />
          <rect x="23" y="20" width="18" height="15" rx="3.5" fill={fill} />
          <circle cx="32" cy="27.5" r="2.4" fill={WHITE} />
        </>
      )}
    </FeatureArt>
  );
}
