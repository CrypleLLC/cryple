import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getAttributesFromExtensions, resolveExtensions } from '@tiptap/core';
import { documentExtensions } from './extensions';

const INJECTED = 'red; background-image: url(https://tracker.example/opened)';

function attribute(type: string, name: string) {
  const found = getAttributesFromExtensions(resolveExtensions(documentExtensions(new Y.Doc()))).find(
    (entry) => entry.type === type && entry.name === name,
  );
  if (found === undefined) {
    throw new Error(`the editor has no ${name} attribute on ${type}`);
  }
  return found.attribute;
}

describe('the document editor extensions', () => {
  it.each([
    ['textStyle', 'color'],
    ['textStyle', 'fontFamily'],
    ['textStyle', 'fontSize'],
    ['paragraph', 'lineHeight'],
    ['heading', 'lineHeight'],
    ['highlight', 'color'],
  ])('%s.%s renders nothing for an injected value', (type, name) => {
    expect(attribute(type, name).renderHTML?.({ [name]: INJECTED })).toEqual({});
  });

  it('parses an injected highlight data-color as nothing', () => {
    const pasted = { getAttribute: (name: string) => (name === 'data-color' ? INJECTED : null) };
    expect(attribute('highlight', 'color').parseHTML?.(pasted as unknown as HTMLElement)).toBeNull();
  });

  it('still renders what the toolbar sets', () => {
    expect(attribute('textStyle', 'color').renderHTML?.({ color: '#b91c1c' })).toEqual({
      style: 'color: #b91c1c',
    });
    expect(attribute('highlight', 'color').renderHTML?.({ color: '#fef08a' })).toEqual({
      'data-color': '#fef08a',
      style: 'background-color: #fef08a; color: inherit',
    });
  });
});
