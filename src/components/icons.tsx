import type { ReactNode, SVGProps } from 'react';

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

export function GuardiansIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 5 6.2v4.9c0 4.2 2.9 7.5 7 9.4 4.1-1.9 7-5.2 7-9.4V6.2L12 3.5Z" />
      <path d="m9.2 11.8 2 2 3.6-3.8" />
    </Icon>
  );
}

export function SuccessionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.8 19.5c.6-3 2.7-4.7 5.2-4.7s4.6 1.7 5.2 4.7" />
      <circle cx="17" cy="10.2" r="2.4" />
      <path d="M15.6 14.9c2.4.2 4.1 1.6 4.6 4" />
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

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
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
