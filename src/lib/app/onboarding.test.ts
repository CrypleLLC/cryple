import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import {
  canEnterVault,
  canGoBack,
  checkMnemonic,
  checkPin,
  previousStep,
  INITIAL_ONBOARDING,
  isReadyToEnroll,
  MODE_COPY,
  mnemonicSentence,
  mnemonicWords,
  onboardingReducer,
  PIN_STEP_COPY,
  RECOVERY_KIT_STEP_COPY,
  PHRASE_NOT_KEPT,
  ENROL_STEP_COPY,
  type OnboardingState,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const pin = vectors.server_auth_token.pin;

function run(events: Parameters<typeof onboardingReducer>[1][]): OnboardingState {
  return events.reduce(onboardingReducer, INITIAL_ONBOARDING);
}

describe('PIN rules are enforced at creation, with copy a user can act on', () => {
  it('accepts a PIN that breaks none of the rules', () => {
    expect(checkPin(pin)).toEqual({ ok: true });
  });

  it('rejects the three forbidden shapes with distinct messages', () => {
    expect(checkPin('111111')).toMatchObject({ ok: false });
    expect(checkPin('123456')).toMatchObject({ ok: false });
    expect(checkPin('654321')).toMatchObject({ ok: false });

    const messages = new Set(
      ['111111', '123456', '654321'].map((candidate) => {
        const result = checkPin(candidate);
        return result.ok ? '' : result.message;
      }),
    );
    expect(messages.size).toBe(3);
  });

  it('rejects the wrong length and non-digits', () => {
    expect(checkPin('12345')).toMatchObject({ ok: false });
    expect(checkPin('12345a')).toMatchObject({ ok: false });
  });

  it('rejects a mismatched confirmation', () => {
    expect(checkPin(pin, '999999')).toMatchObject({ ok: false });
    expect(checkPin(pin, pin)).toEqual({ ok: true });
  });
});

describe('mnemonic entry validates the checksum before any derivation', () => {
  it('accepts the fixture phrase', () => {
    expect(checkMnemonic(mnemonic)).toEqual({ ok: true, wordCount: 12 });
  });

  it('rejects an empty phrase', () => {
    expect(checkMnemonic('   ')).toMatchObject({ ok: false });
  });

  it('rejects an unsupported word count before checking the checksum', () => {
    const result = checkMnemonic('abandon abandon abandon');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/12 or 24 words/);
  });

  it('rejects a phrase whose checksum fails', () => {
    const words = mnemonicWords(mnemonic);
    const broken = [...words.slice(0, 11), 'zoo'].join(' ');

    const result = checkMnemonic(broken);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/checksum/);
  });

  it('tolerates extra whitespace', () => {
    expect(checkMnemonic(`  ${mnemonic.replace(/ /g, '   ')}  `)).toMatchObject({ ok: true });
  });
});

describe('the onboarding flow', () => {
  it('sends a generated phrase straight to the PIN', () => {
    const state = run([
      { type: 'choose-origin', origin: 'generate' },
      { type: 'mnemonic-ready', mnemonic },
    ]);

    expect(state.step).toBe('pin');
    expect(state.mnemonic).toBe(mnemonic);
  });

  it('hands a new account its recovery kit once the server has named it', () => {
    const enrolled = run([
      { type: 'choose-origin', origin: 'generate' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin, paranoid: true },
      { type: 'enrolled', username: '3f1c8a2b9d4e' },
    ]);

    expect(enrolled.step).toBe('recovery-kit');
    expect(enrolled.username).toBe('3f1c8a2b9d4e');
    expect(enrolled.mnemonic).toBe(mnemonic);
    expect(enrolled.pin).toBeUndefined();
  });

  it('opens the vault only after the kit has been downloaded', () => {
    const atKit = run([
      { type: 'choose-origin', origin: 'generate' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin, paranoid: false },
      { type: 'enrolled', username: '3f1c8a2b9d4e' },
    ]);
    expect(canEnterVault(atKit)).toBe(false);

    const saved = onboardingReducer(atKit, { type: 'recovery-kit-saved' });
    expect(canEnterVault(saved)).toBe(true);
  });

  it('ignores a kit reported saved before there is an account to name on it', () => {
    const atPin = run([
      { type: 'choose-origin', origin: 'generate' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'recovery-kit-saved' },
    ]);

    expect(atPin.recoveryKitSaved).toBeUndefined();
    expect(canEnterVault(atPin)).toBe(false);
  });

  it('gives a signed-in account no kit step — the phrase came from the user', () => {
    const enrolled = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin, paranoid: false },
      { type: 'enrolled', username: '3f1c8a2b9d4e' },
    ]);

    expect(enrolled.step).toBe('done');
  });

  it('keeps the PIN out of the kit step copy', () => {
    expect(JSON.stringify(RECOVERY_KIT_STEP_COPY)).not.toMatch(/\bPIN\b/i);
  });

  it('sends an imported phrase straight to the PIN — there is nothing to back up', () => {
    const state = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
    ]);

    expect(state.step).toBe('pin');
  });

  it('asks for a PIN in both modes, because it is what wraps the local phrase', () => {
    for (const paranoid of [true, false]) {
      const chosen = run([
        { type: 'choose-origin', origin: 'import' },
        { type: 'mnemonic-ready', mnemonic },
        { type: 'pin-chosen', pin, paranoid },
      ]);

      expect(chosen.step).toBe('enrolling');
      expect(chosen.pin).toBe(pin);
      expect(chosen.paranoid).toBe(paranoid);
      expect(isReadyToEnroll(chosen)).toBe(true);
    }
  });

  it('rejects a weak PIN whichever mode was ticked', () => {
    for (const paranoid of [true, false]) {
      const rejected = run([
        { type: 'choose-origin', origin: 'import' },
        { type: 'mnemonic-ready', mnemonic },
        { type: 'pin-chosen', pin: '111111', paranoid },
      ]);

      expect(rejected.step).toBe('pin');
      expect(rejected.pin).toBeUndefined();
      expect(rejected.error).toBeDefined();
    }
  });

  it('lets the PIN step go back to the phrase, dropping the half-entered PIN', () => {
    const back = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'back' },
    ]);

    expect(back.step).toBe('import');
    expect(back.pin).toBeUndefined();
    expect(back.mnemonic).toBe(mnemonic);
  });
});

describe('going back a step', () => {
  it('returns the generate branch to the start, discarding the unused phrase', () => {
    const atPin = run([
      { type: 'choose-origin', origin: 'generate' },
      { type: 'mnemonic-ready', mnemonic },
    ]);
    expect(atPin.step).toBe('pin');

    const atOrigin = onboardingReducer(atPin, { type: 'back' });
    expect(atOrigin.step).toBe('origin');
    expect(atOrigin.mnemonic).toBeUndefined();
    expect(atOrigin.origin).toBeUndefined();
  });

  it('retraces the import branch to the phrase, keeping it so it can be edited', () => {
    const atMode = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
    ]);

    const atImport = onboardingReducer(atMode, { type: 'back' });
    expect(atImport.step).toBe('import');
    expect(atImport.mnemonic).toBe(mnemonic);
  });

  it('forgets the phrase and the branch on returning to the very first step', () => {
    const atOrigin = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'back' },
      { type: 'back' },
    ]);

    expect(atOrigin.step).toBe('origin');
    expect(atOrigin.mnemonic).toBeUndefined();
    expect(atOrigin.origin).toBeUndefined();
  });

  it('keeps the word count, which is the one origin-step choice worth carrying', () => {
    const atOrigin = run([
      { type: 'choose-origin', origin: 'generate', wordCount: 24 },
      { type: 'back' },
    ]);

    expect(atOrigin.step).toBe('origin');
    expect(atOrigin.wordCount).toBe(24);
  });

  it('clears the PIN and the mode when stepping back off the PIN screen', () => {
    const back = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin: '111111', paranoid: true },
      { type: 'back' },
    ]);

    expect(back.step).toBe('import');
    expect(back.paranoid).toBeUndefined();
    expect(back.pin).toBeUndefined();
  });

  it('clears any error, so a rejection does not follow the user backwards', () => {
    const failed = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin: '123456', paranoid: true },
    ]);
    expect(failed.error).toBeDefined();

    expect(onboardingReducer(failed, { type: 'back' }).error).toBeUndefined();
  });

  it('has nowhere to go from the first step, or once enrolment is under way', () => {
    expect(canGoBack(INITIAL_ONBOARDING)).toBe(false);
    expect(previousStep(INITIAL_ONBOARDING)).toBeUndefined();

    const enrolling = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin, paranoid: false },
    ]);
    expect(enrolling.step).toBe('enrolling');
    expect(canGoBack(enrolling)).toBe(false);
    expect(onboardingReducer(enrolling, { type: 'back' })).toEqual(enrolling);
  });

  it('offers a way back only before the account exists', () => {
    const reachable = run([
      { type: 'choose-origin', origin: 'generate' },
      { type: 'mnemonic-ready', mnemonic },
    ]);

    for (const step of ['import', 'pin'] as const) {
      expect(canGoBack({ ...reachable, step })).toBe(true);
    }
    for (const step of ['origin', 'enrolling', 'recovery-kit', 'done'] as const) {
      expect(canGoBack({ ...reachable, step })).toBe(false);
    }
  });

  it('refuses a phrase that fails its checksum without advancing', () => {
    const state = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic: 'not a real recovery phrase at all here' },
    ]);

    expect(state.step).toBe('import');
    expect(state.mnemonic).toBeUndefined();
    expect(state.error).toBeDefined();
  });

  it('refuses a weak PIN without advancing to enrolment', () => {
    const state = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin: '123456', paranoid: true },
    ]);

    expect(state.step).toBe('pin');
    expect(state.pin).toBeUndefined();
    expect(state.error).toMatch(/counts up/);
  });

  it('needs a PIN before enrolling, in either mode', () => {
    for (const paranoid of [true, false]) {
      const withoutPin = run([
        { type: 'choose-origin', origin: 'import' },
        { type: 'mnemonic-ready', mnemonic },
      ]);
      expect(isReadyToEnroll(withoutPin)).toBe(false);

      const withPin = onboardingReducer(withoutPin, { type: 'pin-chosen', pin, paranoid });
      expect(isReadyToEnroll(withPin)).toBe(true);
    }
  });

  it('returns to the PIN screen when enrolment fails, in either mode', () => {
    const paranoid = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin, paranoid: true },
    ]);
    expect(paranoid.step).toBe('enrolling');

    const paranoidFailed = onboardingReducer(paranoid, {
      type: 'failed',
      message: 'could not sign in',
    });
    expect(paranoidFailed.step).toBe('pin');
    expect(paranoidFailed.mnemonic).toBe(mnemonic);
    expect(paranoidFailed.error).toBe('could not sign in');

    const standard = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin, paranoid: false },
    ]);

    const standardFailed = onboardingReducer(standard, {
      type: 'failed',
      message: 'could not sign in',
    });
    expect(standardFailed.step).toBe('pin');
    expect(standardFailed.mnemonic).toBe(mnemonic);
  });

  it('says the mode choice is a one-way door, and never offers to remove a PIN', () => {
    expect(MODE_COPY.oneWayDoor).toMatch(/no way back to Standard/);
    expect(MODE_COPY.oneWayDoor).toMatch(/lost for ever/);
    expect(JSON.stringify(MODE_COPY)).not.toMatch(/disable|remove the PIN|turn off/i);
  });

  it('presents Standard as a deliberate choice and Paranoid as a PIN on the phrase itself', () => {
    expect(MODE_COPY.standard.tradeoff).toMatch(/only unlocks this browser/);
    expect(MODE_COPY.standard.tradeoff).toMatch(/deliberate choice/);
    expect(MODE_COPY.paranoid.summary).toMatch(/add a device/);
    expect(PIN_STEP_COPY.subtitle).toMatch(/never leaves this device/);
  });

  it('says the browser does not keep the phrase, what it is needed for, and how a lost device goes', () => {
    expect(PHRASE_NOT_KEPT).toMatch(/does not keep your recovery phrase/);
    expect(PHRASE_NOT_KEPT).toMatch(/add a device/);
    expect(PHRASE_NOT_KEPT).toMatch(/remove a device you lost/);
    expect(RECOVERY_KIT_STEP_COPY.warning).toContain(PHRASE_NOT_KEPT);
    expect(ENROL_STEP_COPY.summary).toContain(PHRASE_NOT_KEPT);
  });

  it('states phase 1 honestly: a typed phrase is in the page’s memory', () => {
    expect(ENROL_STEP_COPY.exposure).toMatch(/memory/);
    expect(ENROL_STEP_COPY.exposure).toMatch(/Brave/);
  });
});

describe('the generated phrase is shown as one sentence, not a numbered list', () => {
  it('joins the words with single spaces', () => {
    expect(mnemonicSentence(mnemonic)).toBe(mnemonicWords(mnemonic).join(' '));
    expect(mnemonicSentence(mnemonic).split(' ')).toHaveLength(12);
  });

  it('collapses stray whitespace so what is written down matches what is shown', () => {
    expect(mnemonicSentence(`  ${mnemonic.replace(/ /g, '   ')}\n`)).toBe(mnemonic);
  });
});
