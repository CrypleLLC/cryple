import { describe, expect, it } from 'vitest';
import { PRIVATE_TEXT_ATTRIBUTES, PRIVATE_TEXT_PROPS } from './private-text';

describe('private text', () => {
  it('turns off every browser feature that ships typed text to a remote service', () => {
    expect(PRIVATE_TEXT_ATTRIBUTES).toEqual({
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off',
      translate: 'no',
      'data-gramm': 'false',
      'data-gramm_editor': 'false',
      'data-enable-grammarly': 'false',
    });
  });

  it('says the same thing to React and to a raw contentEditable', () => {
    expect(Object.keys(PRIVATE_TEXT_ATTRIBUTES)).toHaveLength(Object.keys(PRIVATE_TEXT_PROPS).length);
    expect(PRIVATE_TEXT_PROPS.spellCheck).toBe(false);
  });
});
