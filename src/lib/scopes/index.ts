export const SCOPES = [
  'admin',
  'passwords',
  'secrets',
  'notes',
  'documents',
  'files',
  'sharing',
] as const;

export type Scope = (typeof SCOPES)[number];

export const KEYRING_SCOPES = [
  'passwords',
  'secrets',
  'notes',
  'documents',
  'files',
  'sharing',
] as const satisfies readonly Scope[];

export type KeyringScope = (typeof KEYRING_SCOPES)[number];

export const ITEM_SCOPES = ['secrets', 'notes', 'documents', 'files'] as const satisfies readonly KeyringScope[];

export type ItemScope = (typeof ITEM_SCOPES)[number];

export const FULL_DEVICE_SCOPES: readonly Scope[] = SCOPES;

export const CANONICAL_SCOPE_LIST = SCOPES.join(',');

const ITEM_TYPE_SCOPES = {
  secret: 'secrets',
  note: 'notes',
  document: 'documents',
  file: 'files',
} as const satisfies Record<string, ItemScope>;

export type ScopedItemType = keyof typeof ITEM_TYPE_SCOPES;

export class InvalidScopeListError extends Error {
  constructor(list: string) {
    super(`"${list}" is not a non-empty canonical scope list`);
    this.name = 'InvalidScopeListError';
  }
}

export function scopeRank(name: string): number {
  return (SCOPES as readonly string[]).indexOf(name);
}

export function isScope(name: string): name is Scope {
  return scopeRank(name) >= 0;
}

export function isKeyringScope(name: string): name is KeyringScope {
  return (KEYRING_SCOPES as readonly string[]).includes(name);
}

export function scopeForItemType(itemType: ScopedItemType): ItemScope {
  return ITEM_TYPE_SCOPES[itemType];
}

export function parseScopeList(list: string): Scope[] {
  if (list === '') {
    throw new InvalidScopeListError(list);
  }
  const names = list.split(',');
  let previous = -1;
  for (const name of names) {
    const rank = scopeRank(name);
    if (rank <= previous) {
      throw new InvalidScopeListError(list);
    }
    previous = rank;
  }
  return names as Scope[];
}

export function formatScopeList(scopes: Iterable<string>): string {
  const held = new Set(scopes);
  const ordered = SCOPES.filter((name) => held.has(name));
  if (ordered.length === 0 || ordered.length !== held.size) {
    throw new InvalidScopeListError([...held].join(','));
  }
  return ordered.join(',');
}

export function keyringScopesOf(scopes: Iterable<string>): KeyringScope[] {
  const held = new Set(scopes);
  return KEYRING_SCOPES.filter((name) => held.has(name));
}

export function isFullDevice(scopes: Iterable<string>): boolean {
  return new Set(scopes).has('admin');
}
