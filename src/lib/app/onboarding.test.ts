import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import {
  buildVerificationChallenge,
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
  verifyBackup,
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

describe('backup verification', () => {
  it('asks for distinct word positions in ascending order', () => {
    const indices = buildVerificationChallenge(mnemonic, 3);

    expect(indices).toHaveLength(3);
    expect(new Set(indices).size).toBe(3);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
    expect(indices.every((index) => index >= 0 && index < 12)).toBe(true);
  });

  it('never asks for more positions than the phrase has', () => {
    expect(buildVerificationChallenge(mnemonic, 50)).toHaveLength(12);
  });

  it('accepts the right words and rejects a wrong one', () => {
    const words = mnemonicWords(mnemonic);
    const indices = [0, 5, 11];
    const answers = indices.map((index) => words[index]);

    expect(verifyBackup(mnemonic, indices, answers)).toBe(true);
    expect(verifyBackup(mnemonic, indices, [answers[0], 'wrong', answers[2]])).toBe(false);
  });

  it('is tolerant of case and stray whitespace in what the user types', () => {
    const words = mnemonicWords(mnemonic);
    const indices = [1, 2];
    const typed = indices.map((index) => `  ${words[index].toUpperCase()} `);

    expect(verifyBackup(mnemonic, indices, typed)).toBe(true);
  });

  it('rejects a short answer list rather than passing on a prefix match', () => {
    const words = mnemonicWords(mnemonic);
    expect(verifyBackup(mnemonic, [0, 1], [words[0]])).toBe(false);
  });
});

describe('the onboarding flow', () => {
  it('sends a generated phrase through backup and verification', () => {
    const state = run([
      { type: 'choose-origin', origin: 'generate' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'backup-confirmed' },
    ]);

    expect(state.step).toBe('verify');
    expect(state.mnemonic).toBe(mnemonic);
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
  it('retraces the generate branch one step at a time, never resetting the flow', () => {
    const atMode = run([
      { type: 'choose-origin', origin: 'generate' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'backup-confirmed' },
      { type: 'backup-confirmed' },
    ]);
    expect(atMode.step).toBe('pin');

    const atVerify = onboardingReducer(atMode, { type: 'back' });
    expect(atVerify.step).toBe('verify');
    expect(atVerify.mnemonic).toBe(mnemonic);

    const atBackup = onboardingReducer(atVerify, { type: 'back' });
    expect(atBackup.step).toBe('backup');
    expect(atBackup.mnemonic).toBe(mnemonic);

    const atOrigin = onboardingReducer(atBackup, { type: 'back' });
    expect(atOrigin.step).toBe('origin');
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

  it('offers a way back from every step that is not the first or in flight', () => {
    const reachable = run([
      { type: 'choose-origin', origin: 'generate' },
      { type: 'mnemonic-ready', mnemonic },
    ]);

    for (const step of ['backup', 'verify', 'import', 'pin'] as const) {
      expect(canGoBack({ ...reachable, step })).toBe(true);
    }
    for (const step of ['origin', 'enrolling', 'done'] as const) {
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
    expect(MODE_COPY.oneWayDoor).toMatch(/never back/);
    expect(JSON.stringify(MODE_COPY)).not.toMatch(/disable|remove the PIN|turn off/i);
  });

  it('describes the PIN as local in Standard and as a sign-in factor in Paranoid', () => {
    expect(MODE_COPY.standard.tradeoff).toMatch(/stays on this device/);
    expect(MODE_COPY.paranoid.summary).toMatch(/required to sign in/);
    expect(PIN_STEP_COPY.subtitle).toMatch(/encrypts the copy of your phrase kept on this device/);
  });
});

describe('the generated phrase is shown as one sentence, not a numbered list', () => {
  it('joins the words with single spaces', () => {
    expect(mnemonicSentence(mnemonic)).toBe(mnemonicWords(mnemonic).join(' '));
    expect(mnemonicSentence(mnemonic).split(' ')).toHaveLength(12);
  });

  it('collapses stray whitespace so what is copied matches what is shown', () => {
    expect(mnemonicSentence(`  ${mnemonic.replace(/ /g, '   ')}\n`)).toBe(mnemonic);
  });
});
