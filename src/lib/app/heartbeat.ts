import type { ReleaseStatusRecord } from '@/lib/succession';
import type { HeartbeatOperation, SwitchRecord } from '@/lib/chain';

export const CHECK_IN_PROMPT_FRACTION = 0.5;

export const UNFUNDED_DETAIL =
  'Gas cover is unavailable right now, so this check-in cannot be sent. Try again shortly — ' +
  'your switch will not release while you keep checking in.';

export const SIGNING_CAVEAT = 'Only this device can check in for you.';

export type HeartbeatUrgency = 'idle' | 'due' | 'overdue' | 'contested' | 'unconfigured';

export interface HeartbeatView {
  urgency: HeartbeatUrgency;
  offerOnLogin: boolean;
  headline: string;
  actionLabel: string;
  lastCheckIn?: Date;
  dueAt?: Date;
}

export function describeOperation(operation: HeartbeatOperation): string {
  return operation === 'check-in' ? "I'm alive" : 'Turn on my switch';
}

function view(
  urgency: HeartbeatUrgency,
  headline: string,
  actionLabel: string,
  lastCheckIn?: Date,
  dueAt?: Date,
): HeartbeatView {
  return {
    urgency,
    offerOnLogin: urgency !== 'idle',
    headline,
    actionLabel,
    ...(lastCheckIn === undefined ? {} : { lastCheckIn }),
    ...(dueAt === undefined ? {} : { dueAt }),
  };
}

export function buildHeartbeatView(
  record: ReleaseStatusRecord,
  chain?: SwitchRecord,
  now: Date = new Date(),
): HeartbeatView {
  const status = chain?.status ?? record.chain.status;
  const lastCheckInSeconds = chain ? chain.lastCheckIn : record.chain.last_check_in;
  const inactivity = chain
    ? chain.inactivityPeriodSeconds
    : record.chain.inactivity_period_seconds;

  if (status === 'unconfigured' || lastCheckInSeconds === undefined) {
    return view(
      'unconfigured',
      'Your switch is not running yet.',
      'Turn on my switch',
    );
  }

  const lastCheckIn = new Date(lastCheckInSeconds * 1000);

  if (status === 'released') {
    return view('contested', 'Your vault has been released.', "I'm alive", lastCheckIn);
  }

  if (status === 'contest') {
    return view(
      'contested',
      'A release countdown is running. Check in now to stop it.',
      "I'm alive",
      lastCheckIn,
    );
  }

  if (inactivity === undefined || inactivity === 0) {
    return view('idle', 'Your switch is active.', "I'm alive", lastCheckIn);
  }

  const dueAt = new Date((lastCheckInSeconds + inactivity) * 1000);
  const remaining = Math.floor((dueAt.getTime() - now.getTime()) / 1000);

  if (remaining <= 0) {
    return view(
      'overdue',
      'Your guardians can start a release now. Check in to reset it.',
      "I'm alive",
      lastCheckIn,
      dueAt,
    );
  }

  if (inactivity - remaining >= inactivity * CHECK_IN_PROMPT_FRACTION) {
    return view(
      'due',
      'It has been a while since you checked in.',
      "I'm alive",
      lastCheckIn,
      dueAt,
    );
  }

  return view('idle', 'Your switch is active.', "I'm alive", lastCheckIn, dueAt);
}
