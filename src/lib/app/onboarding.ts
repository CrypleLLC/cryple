import { countWords, isValidMnemonic, SUPPORTED_WORD_COUNTS, type MnemonicWordCount } from '@/lib/keys';
import { validatePin, type PinRejection } from '@/lib/pin';

export type OnboardingOrigin = 'generate' | 'import';

export type OnboardingStep =
  | 'origin'
  | 'backup'
  | 'verify'
  | 'import'
  | 'pin'
  | 'mode'
  | 'enrolling'
  | 'done';

export interface OnboardingState {
  step: OnboardingStep;
  origin?: OnboardingOrigin;
  wordCount: MnemonicWordCount;
  mnemonic?: string;
  pin?: string;
  paranoid?: boolean;
  error?: string;
}

export type OnboardingEvent =
  | { type: 'choose-origin'; origin: OnboardingOrigin; wordCount?: MnemonicWordCount }
  | { type: 'mnemonic-ready'; mnemonic: string }
  | { type: 'backup-confirmed' }
  | { type: 'pin-chosen'; pin: string }
  | { type: 'mode-chosen'; paranoid: boolean }
  | { type: 'enrolled' }
  | { type: 'failed'; message: string }
  | { type: 'back' };

export const INITIAL_ONBOARDING: OnboardingState = { step: 'origin', wordCount: 12 };

const PIN_REJECTION_COPY: Record<PinRejection, string> = {
  'wrong-length': 'Your PIN must be exactly 6 digits.',
  'non-digit': 'Your PIN must be digits only.',
  'repeating-digit': 'That PIN repeats one digit. Choose a less predictable one.',
  'ascending-sequence': 'That PIN counts up. Choose a less predictable one.',
  'descending-sequence': 'That PIN counts down. Choose a less predictable one.',
};

export const MODE_COPY = {
  standard: {
    title: 'Standard',
    summary: 'Your recovery phrase alone unlocks this account.',
  },
  paranoid: {
    title: 'Paranoid',
    summary: 'A 6-digit PIN is required alongside your recovery phrase.',
  },
  oneWayDoor:
    'You can move from Standard to Paranoid later, but never back. There is no way to remove a ' +
    'PIN once it is set — that is what protects you if your recovery phrase is ever stolen.',
} as const;

export const SEED_WARNING =
  'Write these words down and store them offline. Anyone who has them has your vault, and nobody ' +
  'can restore them for you if you lose them.';

export function describePinRejection(reason: PinRejection): string {
  return PIN_REJECTION_COPY[reason];
}

export type PinFeedback = { ok: true } | { ok: false; message: string };

export function checkPin(pin: string, confirmation?: string): PinFeedback {
  const result = validatePin(pin);
  if (!result.valid) {
    return { ok: false, message: describePinRejection(result.reason) };
  }
  if (confirmation !== undefined && confirmation !== pin) {
    return { ok: false, message: 'Those PINs do not match.' };
  }
  return { ok: true };
}

export type MnemonicFeedback = { ok: true; wordCount: number } | { ok: false; message: string };

export function checkMnemonic(mnemonic: string): MnemonicFeedback {
  const words = countWords(mnemonic);

  if (words === 0) {
    return { ok: false, message: 'Enter your recovery phrase.' };
  }
  if (!SUPPORTED_WORD_COUNTS.includes(words as MnemonicWordCount)) {
    return {
      ok: false,
      message: `A recovery phrase is 12 or 24 words. You entered ${words}.`,
    };
  }
  if (!isValidMnemonic(mnemonic)) {
    return {
      ok: false,
      message: 'That recovery phrase failed its checksum. Check for typos or reordered words.',
    };
  }

  return { ok: true, wordCount: words };
}

export function mnemonicWords(mnemonic: string): string[] {
  return mnemonic.normalize('NFKD').trim().split(/\s+/).filter(Boolean);
}

export function buildVerificationChallenge(
  mnemonic: string,
  count = 3,
  pick: (max: number) => number = (max) => Math.floor(Math.random() * max),
): number[] {
  const total = mnemonicWords(mnemonic).length;
  const chosen = new Set<number>();

  while (chosen.size < Math.min(count, total)) {
    chosen.add(pick(total));
  }

  return [...chosen].sort((a, b) => a - b);
}

export function verifyBackup(
  mnemonic: string,
  indices: readonly number[],
  answers: readonly string[],
): boolean {
  const words = mnemonicWords(mnemonic);

  return (
    indices.length === answers.length &&
    indices.every(
      (index, position) =>
        words[index] !== undefined &&
        words[index] === answers[position].normalize('NFKD').trim().toLowerCase(),
    )
  );
}

export function onboardingReducer(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState {
  switch (event.type) {
    case 'choose-origin':
      return {
        ...state,
        step: event.origin === 'generate' ? 'backup' : 'import',
        origin: event.origin,
        wordCount: event.wordCount ?? state.wordCount,
        error: undefined,
      };

    case 'mnemonic-ready': {
      if (!isValidMnemonic(event.mnemonic)) {
        return { ...state, error: 'That recovery phrase failed its checksum.' };
      }
      return {
        ...state,
        mnemonic: event.mnemonic,
        step: state.origin === 'generate' ? state.step : 'pin',
        error: undefined,
      };
    }

    case 'backup-confirmed':
      return state.step === 'backup'
        ? { ...state, step: 'verify', error: undefined }
        : { ...state, step: 'pin', error: undefined };

    case 'pin-chosen': {
      const feedback = checkPin(event.pin);
      if (!feedback.ok) {
        return { ...state, error: feedback.message };
      }
      return { ...state, pin: event.pin, step: 'mode', error: undefined };
    }

    case 'mode-chosen':
      return { ...state, paranoid: event.paranoid, step: 'enrolling', error: undefined };

    case 'enrolled':
      return { ...state, step: 'done', error: undefined };

    case 'failed':
      return { ...state, step: state.step === 'enrolling' ? 'mode' : state.step, error: event.message };

    case 'back':
      return { ...INITIAL_ONBOARDING, wordCount: state.wordCount };
  }
}

export function isReadyToEnroll(
  state: OnboardingState,
): state is OnboardingState & { mnemonic: string; pin: string; paranoid: boolean } {
  return (
    state.mnemonic !== undefined && state.pin !== undefined && state.paranoid !== undefined
  );
}
