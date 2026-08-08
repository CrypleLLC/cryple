import {
  canVoteOn,
  GUARDIAN_INBOX_POLL_INTERVAL_MS,
  pendingInvitations,
  type Guardianship,
  type PendingPinReset,
  type PendingSession,
} from '@/lib/recovery';

export const INBOX_POLL_INTERVAL_MS = GUARDIAN_INBOX_POLL_INTERVAL_MS;

export type InboxKind = 'guardian-invite' | 'recovery-session' | 'pin-reset';

export interface InboxItem {
  kind: InboxKind;
  id: string;
  ownerUsername: string;
  actionable: boolean;
  headline: string;
  detail: string;
  createdAt: string;
  expiresAt?: string;
}

export const GUARDIAN_INVITE_HEADLINE = 'asked you to be their guardian';
export const RECOVERY_SESSION_HEADLINE = 'is recovering their vault';
export const PIN_RESET_HEADLINE = 'is resetting their PIN';

export const GUARDIAN_INVITE_DETAIL =
  'Accepting shows you their account address and counts you toward the guardians they need to ' +
  'get back in. There is no way to decline — leave it if you do not want this.';

function guardianInviteItem(invitation: Guardianship): InboxItem {
  return {
    kind: 'guardian-invite',
    id: invitation.id,
    ownerUsername: invitation.owner_username,
    actionable: true,
    headline: `${invitation.owner_username} ${GUARDIAN_INVITE_HEADLINE}`,
    detail: GUARDIAN_INVITE_DETAIL,
    createdAt: invitation.created_at,
  };
}

function recoveryItem(session: PendingSession): InboxItem {
  return {
    kind: 'recovery-session',
    id: session.session_id,
    ownerUsername: session.owner_username,
    actionable: !session.submitted,
    headline: `${session.owner_username} ${RECOVERY_SESSION_HEADLINE}`,
    detail: session.submitted
      ? 'You have already sent your share.'
      : 'Send your share to help them back in.',
    createdAt: session.created_at,
    expiresAt: session.expires_at,
  };
}

function pinResetItem(reset: PendingPinReset): InboxItem {
  return {
    kind: 'pin-reset',
    id: reset.request_id,
    ownerUsername: reset.owner_username,
    actionable: canVoteOn(reset),
    headline: `${reset.owner_username} ${PIN_RESET_HEADLINE}`,
    detail:
      reset.status === 'contest_period'
        ? 'Enough guardians have approved. This is now in its contest period.'
        : reset.voted
          ? 'You have already approved this.'
          : 'Approve only if you are sure this is really them.',
    createdAt: reset.created_at,
  };
}

export function buildInbox(
  sessions: readonly PendingSession[],
  resets: readonly PendingPinReset[],
  guardianships: readonly Guardianship[] = [],
): InboxItem[] {
  return [
    ...pendingInvitations(guardianships).map(guardianInviteItem),
    ...sessions.map(recoveryItem),
    ...resets.map(pinResetItem),
  ].sort((a, b) => {
    if (a.actionable !== b.actionable) {
      return a.actionable ? -1 : 1;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export const INBOX_ACTION_LABELS: Record<InboxKind, { idle: string; busy: string }> = {
  'guardian-invite': { idle: 'Accept', busy: 'Accepting…' },
  'pin-reset': { idle: 'Approve', busy: 'Sending…' },
  'recovery-session': { idle: 'Send my share', busy: 'Sending…' },
};

export function actionableCount(items: readonly InboxItem[]): number {
  return items.filter((item) => item.actionable).length;
}

export function expiresInMs(item: InboxItem, now: Date = new Date()): number | undefined {
  return item.expiresAt === undefined
    ? undefined
    : Math.max(0, new Date(item.expiresAt).getTime() - now.getTime());
}

export function hasExpired(item: InboxItem, now: Date = new Date()): boolean {
  const remaining = expiresInMs(item, now);
  return remaining !== undefined && remaining === 0;
}
