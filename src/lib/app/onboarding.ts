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
  lostDevices?: boolean;
  username?: string;
  recoveryKitSaved?: boolean;
  error?: string;
}

export type OnboardingEvent =
  | { type: 'choose-origin'; origin: OnboardingOrigin; wordCount?: MnemonicWordCount }
  | { type: 'mnemonic-ready'; mnemonic: string; lostDevices?: boolean }
  | { type: 'pin-chosen'; pin: string; paranoid: boolean }
  | { type: 'enrolled'; username: string }
  | { type: 'create-instead' }
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

export const PHRASE_NOT_KEPT =
  'This browser does not keep your recovery phrase. You type it again to add a device, to bring ' +
  'this browser back if it forgets your account, and to remove a device you lost.';

export const MODE_COPY = {
  standard: {
    title: 'Standard',
    summary: 'Your recovery phrase alone can add a device and recover everything.',
    tradeoff:
      'Your PIN only unlocks this browser. The server rations every try without ever seeing the ' +
      'PIN. Standard is a deliberate choice: with it, nothing but losing your phrase can lock ' +
      'you out.',
  },
  paranoid: {
    title: 'Paranoid',
    summary:
      'Your recovery phrase also needs an account PIN before it can add a device or delete the ' +
      'account.',
    tradeoff:
      'Someone who steals your phrase still cannot get in without the account PIN. The PIN you ' +
      'choose here becomes your account PIN too.',
  },
  oneWayDoor:
    'There is no way back to Standard, and no reset. If you forget your account PIN, your ' +
    'account is lost for ever, even with your recovery phrase.',
} as const;

export const PIN_STEP_COPY = {
  title: 'Choose your 6-digit PIN',
  subtitle:
    'It unlocks this browser. It never leaves this device: the server helps check it without ' +
    'seeing it, and after too many wrong tries this browser forgets your account until you type ' +
    'your recovery phrase again.',
  signIn:
    'Choose this browser’s PIN. If your account uses Paranoid mode, type your account PIN: it ' +
    'is checked, and becomes this browser’s PIN too.',
} as const;

export const ENROL_STEP_COPY = {
  title: 'Add this browser',
  summary:
    'Your recovery phrase adds this browser as one of your devices. ' + PHRASE_NOT_KEPT,
  lostDevices: 'I lost my other devices: remove them all',
  lostDevicesWarning:
    'Every other device is removed in the same step and every key they held changes, so they ' +
    'cannot read anything saved afterwards. They keep whatever they had already copied.',
  noAccount:
    'No account uses this recovery phrase yet. Check it, or create a new account with it.',
  createInstead: 'Create an account with this phrase',
  exposure:
    'While you type your phrase, it is in this page’s memory. Type it only on a browser you ' +
    'trust, ideally Brave with a profile that has no extensions.',
} as const;

export const RECOVERY_KIT_STEP_COPY = {
  title: 'Save your recovery kit',
  subtitle:
    'A one-page PDF with your username, your recovery phrase and a QR code you can scan to sign ' +
    'in from the mobile app.',
  warning:
    'Print it or keep it on storage that stays offline. Anyone who has your recovery phrase has ' +
    'your vault, and nobody can restore it for you if you lose it. ' +
    PHRASE_NOT_KEPT,
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
        lostDevices: event.lostDevices ?? false,
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
        mnemonic: state.origin === 'generate' ? state.mnemonic : undefined,
        pin: undefined,
        error: undefined,
      };

    case 'create-instead':
      return state.mnemonic === undefined
        ? state
        : { ...state, origin: 'generate', step: 'pin', lostDevices: false, error: undefined };

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
