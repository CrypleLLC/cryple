import { USERNAME_MALFORMED } from '@/lib/api';
import { isUsername, normalizeUsername } from '@/lib/users';

export const USERNAME_COPY = {
  title: 'Your username',
  summary: 'The name other people use to reach your account.',
  label: 'Username',
  hint:
    'Lowercase letters and numbers, with dots, underscores or hyphens between them. Three to ' +
    'sixty-four characters.',
  submit: 'Change username',
  submitting: 'Changing…',
  permanence:
    'Changing your username adds a name, it does not remove one. Every name this account has ' +
    'ever used stays yours for ever: nobody else can take it, and you can switch back to it at ' +
    'any time by claiming it again.',
  oldNameStops:
    'Your old name stops working the moment you change it. Anyone who wrote it down will no ' +
    'longer reach you with it — only your current name resolves to this account.',
  unchanged: 'That is already your username.',
  malformed: USERNAME_MALFORMED,
  renamed: (username: string) => `You are now ${username}.`,
} as const;

export type UsernameCheck = { ok: true; username: string } | { ok: false; message: string };

export function checkUsername(input: string, current: string | undefined): UsernameCheck {
  const claimed = normalizeUsername(input);

  if (!isUsername(claimed)) {
    return { ok: false, message: USERNAME_COPY.malformed };
  }
  if (claimed === current) {
    return { ok: false, message: USERNAME_COPY.unchanged };
  }
  return { ok: true, username: claimed };
}
