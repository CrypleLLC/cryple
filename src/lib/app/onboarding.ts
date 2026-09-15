import { countWords, isValidMnemonic, SUPPORTED_WORD_COUNTS, type MnemonicWordCount } from '@/lib/keys';
import { validatePin, type PinRejection } from '@/lib/pin';

export type OnboardingOrigin = 'generate' | 'import';

export type OnboardingStep = 'origin' | 'import' | 'pin' | 'enrolling' | 'recovery-kit' | 'done';

export interface OnboardingState {
  step: OnboardingStep;
  origin?: OnboardingOrigin;
  wordCount: MnemonicWordCount;
  mnemonic?: string;
  pin?: string;
  paranoid?: boolean;
  username?: string;
  recoveryKitSaved?: boolean;
  error?: string;
}

export type OnboardingEvent =
  | { type: 'choose-origin'; origin: OnboardingOrigin; wordCount?: MnemonicWordCount }
  | { type: 'mnemonic-ready'; mnemonic: string }
  // One event, because mode and PIN are one decision on one screen: the PIN is
  // always set, and `paranoid` only says whether it is also the server factor.
  | { type: 'pin-chosen'; pin: string; paranoid: boolean }
  | { type: 'enrolled'; username: string }
  | { type: 'recovery-kit-saved' }
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
    summary: 'Your recovery phrase alone proves who you are to Cryple.',
    tradeoff:
      'Your PIN stays on this device — it locks the app and encrypts the copy of your phrase ' +
      'kept here, and Cryple never sees it.',
  },
  paranoid: {
    title: 'Paranoid',
    summary: 'Your PIN is also required to sign in, on top of your recovery phrase.',
    tradeoff:
      'Someone who steals your phrase still cannot get in without the PIN. You will be asked ' +
      'for it on every new device.',
  },
  oneWayDoor:
    'You can move from Standard to Paranoid later, but never back. There is no way to stop a ' +
    'PIN being required once it is — that is what protects you if your recovery phrase is ever ' +
    'stolen.',
} as const;

export const PIN_STEP_COPY = {
  title: 'Choose your 6-digit PIN',
  subtitle:
    'It locks the app and encrypts the copy of your phrase kept on this device, so coming back ' +
    'is just the PIN rather than 12 words. Three wrong tries erase that copy.',
  signIn: 'Enter the PIN for this device.',
} as const;

export const RECOVERY_KIT_STEP_COPY = {
  title: 'Save your recovery kit',
  subtitle:
    'A one-page PDF with your username, your recovery phrase and a QR code you can scan to sign ' +
    'in from the mobile app.',
  warning:
    'Print it or keep it on storage that stays offline. Anyone who has your recovery phrase has ' +
    'your vault, and nobody can restore it for you if you lose it.',
  download: 'Download recovery kit',
  downloadAgain: 'Download again',
  preparing: 'Preparing your kit…',
  reveal: 'Show my phrase',
  failed: 'Your recovery kit could not be created. Try again.',
  continue: 'Continue to my vault',
} as const;

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

export function previousStep(state: OnboardingState): OnboardingStep | undefined {
  switch (state.step) {
    case 'import':
      return 'origin';
    case 'pin':
      return state.origin === 'import' ? 'import' : 'origin';
    default:
      return undefined;
  }
}

export function canGoBack(state: OnboardingState): boolean {
  return previousStep(state) !== undefined;
}

export function canEnterVault(state: OnboardingState): boolean {
  return state.step === 'recovery-kit' && state.recoveryKitSaved === true;
}

export function onboardingReducer(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState {
  switch (event.type) {
    case 'choose-origin':
      return {
        ...state,
        step: event.origin === 'generate' ? 'pin' : 'import',
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
        step: 'pin',
        error: undefined,
      };
    }

    case 'pin-chosen': {
      const feedback = checkPin(event.pin);
      if (!feedback.ok) {
        return { ...state, error: feedback.message };
      }
      return {
        ...state,
        pin: event.pin,
        paranoid: event.paranoid,
        step: 'enrolling',
        error: undefined,
      };
    }

    case 'enrolled':
      return {
        ...state,
        step: state.origin === 'generate' ? 'recovery-kit' : 'done',
        username: event.username,
        pin: undefined,
        error: undefined,
      };

    case 'recovery-kit-saved':
      return state.step === 'recovery-kit' ? { ...state, recoveryKitSaved: true } : state;

    case 'failed': {
      if (state.step !== 'enrolling') {
        return { ...state, error: event.message };
      }
      return { ...state, step: 'pin', error: event.message };
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
        paranoid: target === 'pin' ? undefined : state.paranoid,
        pin: target === 'pin' ? undefined : state.pin,
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
