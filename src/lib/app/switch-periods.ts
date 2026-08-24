export interface PeriodOption {
  seconds: number;
  label: string;
}

export const PERIOD_OPTIONS: readonly PeriodOption[] = [
  { seconds: 60, label: '1 minute' },
  { seconds: 180, label: '3 minutes' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 600, label: '10 minutes' },
  { seconds: 1_800, label: '30 minutes' },
  { seconds: 86_400, label: '24 hours' },
] as const;

export const DEFAULT_INACTIVITY_SECONDS = 600;
export const DEFAULT_CONTEST_SECONDS = 300;

export interface SelectablePeriod extends PeriodOption {
  allowed: boolean;
}

export function formatPeriod(seconds: number): string {
  const known = PERIOD_OPTIONS.find((option) => option.seconds === seconds);
  if (known !== undefined) {
    return known.label;
  }

  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

export function selectablePeriods(minimumSeconds: number): SelectablePeriod[] {
  return PERIOD_OPTIONS.map((option) => ({
    ...option,
    allowed: option.seconds >= minimumSeconds,
  }));
}

export function isPeriodAllowed(seconds: number, minimumSeconds: number): boolean {
  return seconds >= minimumSeconds;
}

export function nearestAllowedPeriod(preferredSeconds: number, minimumSeconds: number): number {
  if (preferredSeconds >= minimumSeconds) {
    return preferredSeconds;
  }

  const allowed = PERIOD_OPTIONS.find((option) => option.seconds >= minimumSeconds);
  return allowed?.seconds ?? minimumSeconds;
}

export function periodFloorHint(minimumSeconds: number): string | undefined {
  if (minimumSeconds <= PERIOD_OPTIONS[0].seconds) {
    return undefined;
  }

  return `Anything under ${formatPeriod(minimumSeconds)} is greyed out: the deployed switch refuses it.`;
}

export function describePeriods(
  inactivitySeconds: number,
  contestSeconds: number,
): string {
  return (
    `Your heirs can start a release after ${formatPeriod(inactivitySeconds)} of silence, ` +
    `and you then have ${formatPeriod(contestSeconds)} to stop it.`
  );
}

export function periodsChanged(
  chosen: { inactivitySeconds: number; contestSeconds: number },
  current: { inactivityPeriodSeconds: number; contestPeriodSeconds: number } | undefined,
): boolean {
  if (current === undefined) {
    return false;
  }

  return (
    chosen.inactivitySeconds !== current.inactivityPeriodSeconds ||
    chosen.contestSeconds !== current.contestPeriodSeconds
  );
}

export function formatMoment(moment: Date): string {
  return moment.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
