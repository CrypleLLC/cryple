import { countWords, isValidMnemonic, SUPPORTED_WORD_COUNTS, type MnemonicWordCount } from '@/lib/keys';
import { validatePin, type PinRejection } from '@/lib/pin';

export type OnboardingOrigin = 'generate' | 'import';

export type OnboardingStep =
  | 'origin'
  | 'backup'
  | 'verify'
  | 'import'
  | 'mode'
  | 'pin'
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
    summary: 'No PIN. Your recovery phrase alone unlocks the account.',
    tradeoff:
      'Nothing is kept on this device, so you type your recovery phrase again whenever the ' +
      'session ends — on every reload, and after 15 minutes idle.',
  },
  paranoid: {
    title: 'Paranoid',
    summary: 'A 6-digit PIN is required alongside your recovery phrase to sign in.',
    tradeoff:
      'The PIN also encrypts a copy of your phrase on this device, so unlocking later is just ' +
      'the PIN. Three wrong tries erase that copy.',
  },
  oneWayDoor:
    'You can move from Standard to Paranoid later, but never back. There is no way to remove a ' +
    'PIN once it is set — that is what protects you if your recovery phrase is ever stolen.',
} as const;

export const PIN_STEP_COPY = {
  title: 'Choose your 6-digit PIN',
  subtitle:
    'You will need it alongside your recovery phrase every time you sign in. It also encrypts ' +
    'the copy of your phrase kept on this device — three wrong tries erase that copy.',
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

export function mnemonicSentence(mnemonic: string): string {
  return mnemonicWords(mnemonic).join(' ');
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

export function previousStep(state: OnboardingState): OnboardingStep | undefined {
  switch (state.step) {
    case 'backup':
    case 'import':
      return 'origin';
    case 'verify':
      return 'backup';
    case 'mode':
      if (state.origin === undefined) {
        return 'origin';
      }
      return state.origin === 'import' ? 'import' : 'verify';
    case 'pin':
      return 'mode';
    default:
      return undefined;
  }
}

export function canGoBack(state: OnboardingState): boolean {
  return previousStep(state) !== undefined;
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
        step: state.origin === 'generate' ? state.step : 'mode',
        error: undefined,
      };
    }

    case 'backup-confirmed':
      return state.step === 'backup'
        ? { ...state, step: 'verify', error: undefined }
        : { ...state, step: 'mode', error: undefined };

    case 'mode-chosen':
      return {
        ...state,
        paranoid: event.paranoid,
        pin: undefined,
        step: event.paranoid ? 'pin' : 'enrolling',
        error: undefined,
      };

    case 'pin-chosen': {
      const feedback = checkPin(event.pin);
      if (!feedback.ok) {
        return { ...state, error: feedback.message };
      }
      return { ...state, pin: event.pin, step: 'enrolling', error: undefined };
    }

    case 'enrolled':
      return { ...state, step: 'done', error: undefined };

    case 'failed': {
      if (state.step !== 'enrolling') {
        return { ...state, error: event.message };
      }
      return { ...state, step: state.paranoid === true ? 'pin' : 'mode', error: event.message };
    }

    case 'back': {
      const target = previousStep(state);
      if (target === undefined) {
        return state;
      }
      return {
        ...state,
        step: target,
        origin: target === 'origin' ? undefined : state.origin,
        mnemonic: target === 'origin' ? undefined : state.mnemonic,
        paranoid: target === 'mode' ? undefined : state.paranoid,
        pin: target === 'mode' ? undefined : state.pin,
        error: undefined,
      };
    }
  }
}

export function isReadyToEnroll(
  state: OnboardingState,
): state is OnboardingState & { mnemonic: string; paranoid: boolean } {
  if (state.mnemonic === undefined || state.paranoid === undefined) {
    return false;
  }
  return state.paranoid ? state.pin !== undefined : true;
}
