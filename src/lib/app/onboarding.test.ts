import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import {
  buildVerificationChallenge,
  checkMnemonic,
  checkPin,
  INITIAL_ONBOARDING,
  isReadyToEnroll,
  MODE_COPY,
  mnemonicWords,
  onboardingReducer,
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

  it('refuses a phrase that fails its checksum without advancing', () => {
    const state = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic: 'not a real recovery phrase at all here' },
    ]);

    expect(state.step).toBe('import');
    expect(state.mnemonic).toBeUndefined();
    expect(state.error).toBeDefined();
  });

  it('refuses a weak PIN without advancing to the mode choice', () => {
    const state = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin: '123456' },
    ]);

    expect(state.step).toBe('pin');
    expect(state.pin).toBeUndefined();
    expect(state.error).toMatch(/counts up/);
  });

  it('asks for the PIN in both modes — it always wraps the local seed', () => {
    const state = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin },
      { type: 'mode-chosen', paranoid: false },
    ]);

    expect(state.pin).toBe(pin);
    expect(state.paranoid).toBe(false);
    expect(isReadyToEnroll(state)).toBe(true);
  });

  it('reaches enrolment only with all three inputs present', () => {
    const partial = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin },
    ]);

    expect(isReadyToEnroll(partial)).toBe(false);
    expect(isReadyToEnroll(onboardingReducer(partial, { type: 'mode-chosen', paranoid: true }))).toBe(
      true,
    );
  });

  it('returns to the mode step on a failed enrolment, keeping what was entered', () => {
    const enrolling = run([
      { type: 'choose-origin', origin: 'import' },
      { type: 'mnemonic-ready', mnemonic },
      { type: 'pin-chosen', pin },
      { type: 'mode-chosen', paranoid: true },
    ]);

    const failed = onboardingReducer(enrolling, { type: 'failed', message: 'could not sign in' });

    expect(failed.step).toBe('mode');
    expect(failed.mnemonic).toBe(mnemonic);
    expect(failed.error).toBe('could not sign in');
  });

  it('says the mode choice is a one-way door, and never offers to remove a PIN', () => {
    expect(MODE_COPY.oneWayDoor).toMatch(/never back/);
    expect(JSON.stringify(MODE_COPY)).not.toMatch(/disable|remove the PIN|turn off/i);
  });
});
