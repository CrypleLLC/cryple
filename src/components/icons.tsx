import type { ReactNode, SVGProps } from 'react';
import type { FileKind } from '@/lib/app';

export type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      {...props}
    >
      {children}
    </svg>
  );
}

export function VaultIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 8.5V7.2" />
      <path d="M12 16.8v-1.3" />
      <path d="M15.5 12h1.3" />
      <path d="M7.2 12h1.3" />
    </Icon>
  );
}

export function SecurityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
      <path d="M12 14.5v2" />
    </Icon>
  );
}

export function SharingIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="17.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
      <path d="M8.8 10.8 15.2 7.7" />
      <path d="m8.8 13.2 6.4 3.1" />
    </Icon>
  );
}

export function LockSessionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </Icon>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
      <path d="m17 8 4 4-4 4" />
      <path d="M21 12H10" />
    </Icon>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </Icon>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.9 6.1a8.5 8.5 0 0 1 2.1-.3c6 0 9.5 6.2 9.5 6.2a16 16 0 0 1-2.7 3.4" />
      <path d="M6.4 7.9A16 16 0 0 0 2.5 12S6 18.2 12 18.2c1.4 0 2.7-.3 3.8-.9" />
      <path d="M10 10a2.8 2.8 0 0 0 3.9 3.9" />
      <path d="m4 4 16 16" />
    </Icon>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.7} className="h-4 w-4 shrink-0" {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.7} className="h-4 w-4 shrink-0" {...props}>
      <path d="m5 13 4 4 10-10" />
    </Icon>
  );
}

export function NotesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M8.5 13h7" />
      <path d="M8.5 16.5h4.5" />
    </Icon>
  );
}

export function DocumentsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 2.5H8A2.5 2.5 0 0 0 5.5 5v14A2.5 2.5 0 0 0 8 21.5h8a2.5 2.5 0 0 0 2.5-2.5V6L15 2.5Z" />
      <path d="M14.5 2.5V6a1 1 0 0 0 1 1h3" />
      <path d="M9 11h6" />
      <path d="M9 14.5h6" />
      <path d="M9 18h3.5" />
    </Icon>
  );
}

export function DriveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 13.5 6 5.5a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 5.5l2.5 8" />
      <path d="M3.5 13.5h17v4a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-4Z" />
      <path d="M7 16.75h.01" />
      <path d="M10.5 16.75h.01" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 18.5h15" />
    </Icon>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 20.5v-11" />
      <path d="m7.5 13.5 4.5-4.5 4.5 4.5" />
      <path d="M4.5 5.5h15" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6l-12 12" />
    </Icon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.7} className="h-5 w-5 shrink-0" {...props}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </Icon>
  );
}

export function TitleIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2} {...props}>
      <path d="M6 5v14" />
      <path d="M18 5v14" />
      <path d="M6 12h12" />
    </Icon>
  );
}

export function TopicIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.7} {...props}>
      <circle cx="5" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <path d="M10 7h9" />
      <path d="M10 12h9" />
      <path d="M10 17h9" />
    </Icon>
  );
}

export function TaskListIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.7} {...props}>
      <path d="m3.5 7 1.4 1.4L7.8 5.5" />
      <path d="m3.5 16 1.4 1.4 2.9-2.9" />
      <path d="M11 7h9" />
      <path d="M11 16h9" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.7} className="h-4 w-4 shrink-0" {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7h12l-.8 12.1a1 1 0 0 1-1 .9H7.8a1 1 0 0 1-1-.9L6 7Z" />
      <path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
    </Icon>
  );
}



const FILE_BAND: Record<FileKind, string> = {
  image: 'fill-success',
  video: 'fill-accent-600',
  audio: 'fill-brand-500',
  pdf: 'fill-danger',
  archive: 'fill-warning',
  document: 'fill-brand-600',
  sheet: 'fill-success',
  slides: 'fill-warning',
  code: 'fill-accent-500',
  text: 'fill-ink-muted',
  other: 'fill-ink-faint',
};

const FILE_MARKS: Record<FileKind, ReactNode> = {
  image: (
    <>
      <rect x="16" y="10.5" width="16" height="12" rx="1.6" />
      <circle cx="20.5" cy="14.5" r="1.5" />
      <path d="m17 20.5 4.5-4.5 3 2.8 3-3.2 3.5 4.9" />
    </>
  ),
  video: (
    <>
      <rect x="16" y="10.5" width="16" height="12" rx="1.6" />
      <path d="m22 14 6 2.5-6 2.5z" className="fill-ink-faint" />
    </>
  ),
  audio: (
    <>
      <path d="M21 21V12l9-2v9" />
      <circle cx="18.6" cy="21" r="2.4" />
      <circle cx="27.6" cy="19" r="2.4" />
    </>
  ),
  pdf: null,
  archive: (
    <>
      <path d="M23 10.5h2.6" />
      <path d="M23 14h2.6" />
      <path d="M23 17.5h2.6" />
      <rect x="21.2" y="20" width="6.2" height="5" rx="1.4" />
    </>
  ),
  document: (
    <>
      <path d="M17 12.5h14" />
      <path d="M17 16.5h14" />
      <path d="M17 20.5h9" />
    </>
  ),
  sheet: (
    <>
      <rect x="16" y="10.5" width="16" height="12" rx="1.6" />
      <path d="M16 15h16" />
      <path d="M16 19h16" />
      <path d="M24 10.5v12" />
    </>
  ),
  slides: (
    <>
      <rect x="16" y="10" width="16" height="11" rx="1.6" />
      <path d="M24 21v3" />
      <path d="M20 24h8" />
    </>
  ),
  code: (
    <>
      <path d="m21 11.5-5 5 5 5" />
      <path d="m27 11.5 5 5-5 5" />
    </>
  ),
  text: (
    <>
      <path d="M17 11.5h14" />
      <path d="M17 15h11" />
      <path d="M17 18.5h14" />
      <path d="M17 22h8" />
    </>
  ),
  other: null,
};

export function FileTypeIcon({
  kind,
  extension,
  labelled = true,
  ...props
}: IconProps & { kind: FileKind; extension?: string; labelled?: boolean }) {
  const label = labelled && extension !== undefined && extension !== '' ? extension : undefined;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      fill="none"
      className="h-full w-full"
      {...props}
    >
      <path
        d="M12.5 4h15.9L38 13.6V41.5a2.5 2.5 0 0 1-2.5 2.5h-23A2.5 2.5 0 0 1 10 41.5v-35A2.5 2.5 0 0 1 12.5 4Z"
        className="fill-surface stroke-line-strong"
        strokeWidth={1.4}
      />
      <path
        d="M28.4 4 38 13.6h-7.1a2.5 2.5 0 0 1-2.5-2.5Z"
        className="fill-raised stroke-line-strong"
        strokeWidth={1.4}
      />
      <g
        className="stroke-ink-faint"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {FILE_MARKS[kind]}
      </g>
      <rect x="7" y="27.5" width="27" height="11" rx="2.6" className={FILE_BAND[kind]} />
      {label !== undefined && (
        <text
          x="20.5"
          y="35.4"
          textAnchor="middle"
          className="fill-white"
          fontSize={label.length > 3 ? 7 : 8.4}
          fontWeight={700}
          letterSpacing={0.2}
        >
          {label}
        </text>
      )}
    </svg>
  );
}
