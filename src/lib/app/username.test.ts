import { describe, expect, it } from 'vitest';
import { USERNAME_MALFORMED } from '@/lib/api';
import { checkUsername, USERNAME_COPY } from './username';

describe('checkUsername', () => {
  it('normalises before judging, so case and spacing are not a rejection', () => {
    expect(checkUsername('  PedroSilva  ', '62a772f85e4b')).toEqual({
      ok: true,
      username: 'pedrosilva',
    });
  });

  it('mirrors the server format so the common case never reaches the network', () => {
    for (const rejected of ['ab', '-pedro', 'pedro-', 'pedro silva', 'pedro@silva', 'a'.repeat(65)]) {
      expect(checkUsername(rejected, '62a772f85e4b')).toEqual({
        ok: false,
        message: USERNAME_MALFORMED,
      });
    }
  });

  it('accepts dots, underscores and hyphens between the ends', () => {
    for (const accepted of ['pedro.silva', 'pedro_silva', 'pedro-silva', 'abc', 'a'.repeat(64)]) {
      expect(checkUsername(accepted, '62a772f85e4b').ok).toBe(true);
    }
  });

  it('refuses a claim on the name the account already displays', () => {
    expect(checkUsername('PedroSilva', 'pedrosilva')).toEqual({
      ok: false,
      message: USERNAME_COPY.unchanged,
    });
  });
});

describe('the rename copy says what a rename does', () => {
  it('says a rename adds a name rather than removing one', () => {
    expect(USERNAME_COPY.permanence).toMatch(/adds a name, it does not remove one/);
    expect(USERNAME_COPY.permanence).toMatch(/switch back/);
  });

  it('says the old name stops working', () => {
    expect(USERNAME_COPY.oldNameStops).toMatch(/stops working/);
    expect(USERNAME_COPY.oldNameStops).toMatch(/only your current name resolves/);
  });

  it('never speculates about who holds a name it could not claim', () => {
    const everything = Object.values(USERNAME_COPY)
      .filter((value): value is string => typeof value === 'string')
      .join(' ');
    expect(everything).not.toMatch(/another account|someone else|taken by/i);
  });
});
