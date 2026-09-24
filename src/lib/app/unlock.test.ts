import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { UNLOCK_COPY, wrongPinMessage } from './unlock';
import { accountPinRefusal, ACCOUNT_PIN_REFUSED } from './second-factor';
import { creationPauseSeconds, pausedUploadNote, DEFAULT_CREATION_PAUSE_SECONDS } from './transfers';

describe('a wrong device PIN', () => {
  it('shows the attempts left and says plainly what happens at zero', () => {
    expect(wrongPinMessage(4)).toMatch(/4 attempts left/);
    expect(wrongPinMessage(4)).toMatch(/forgets your account/);
    expect(wrongPinMessage(1)).toMatch(/One attempt left/);
    expect(wrongPinMessage(1)).toMatch(/recovery phrase/);
  });

  it('says a forgotten browser needs the phrase, and never asks for the PIN again', () => {
    expect(UNLOCK_COPY.forgotten).toMatch(/recovery phrase/);
    expect(UNLOCK_COPY.forgotten).not.toMatch(/try the PIN|enter your PIN/i);
  });

  it('tells an offline user it is not a PIN error', () => {
    expect(UNLOCK_COPY.offline).toMatch(/not a PIN error/);
  });
});

describe('a throttled account PIN gives no error of its own', () => {
  it('suggests waiting after two failures for a PIN the user is sure of, and never an auto-retry', () => {
    expect(accountPinRefusal(1)).not.toBe(ACCOUNT_PIN_REFUSED);
    expect(accountPinRefusal(2)).toBe(ACCOUNT_PIN_REFUSED);
    expect(ACCOUNT_PIN_REFUSED).toMatch(/wait a few minutes/);
    expect(ACCOUNT_PIN_REFUSED).toMatch(/still counts as a try/);
  });
});

describe('a 429 on POST /files pauses the queue instead of failing the file', () => {
  it('pauses for Retry-After on file creation, and for nothing else', () => {
    const creation = new ApiError({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      endpoint: 'POST /files',
      retryAfterSeconds: 90,
    });
    expect(creationPauseSeconds(creation)).toBe(90);
    expect(
      creationPauseSeconds(
        new ApiError({ code: 'TOO_MANY_REQUESTS', status: 429, endpoint: 'POST /files' }),
      ),
    ).toBe(DEFAULT_CREATION_PAUSE_SECONDS);
    expect(
      creationPauseSeconds(new ApiError({ code: 'QUOTA_EXCEEDED', status: 507, endpoint: 'POST /files' })),
    ).toBeUndefined();
    expect(
      creationPauseSeconds(new ApiError({ code: 'TOO_MANY_REQUESTS', status: 429, endpoint: 'PATCH /files/x' })),
    ).toBeUndefined();
  });

  it('says nothing failed and when it carries on', () => {
    expect(pausedUploadNote(90)).toMatch(/Nothing failed/);
    expect(pausedUploadNote(90)).toMatch(/in about 2 minutes/);
  });
});
