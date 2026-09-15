export const PRIVATE_TEXT_PROPS = {
  spellCheck: false,
  autoCorrect: 'off',
  autoCapitalize: 'off',
  translate: 'no',
  'data-gramm': 'false',
  'data-gramm_editor': 'false',
  'data-enable-grammarly': 'false',
} as const;

export const PRIVATE_TEXT_ATTRIBUTES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PRIVATE_TEXT_PROPS).map(([name, value]) => [name.toLowerCase(), String(value)]),
);
