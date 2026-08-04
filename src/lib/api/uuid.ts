const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalUuid(value: string): boolean {
  return CANONICAL_UUID.test(value);
}

export function assertCanonicalUuid(value: string, label = 'id'): string {
  if (!isCanonicalUuid(value)) {
    throw new Error(
      `${label} must be a canonical lowercase hyphenated UUID, got "${value}"`,
    );
  }
  return value;
}

export function canonicalizeUuid(value: string, label = 'id'): string {
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith('urn:uuid:')
    ? trimmed.slice('urn:uuid:'.length)
    : trimmed.replace(/^\{(.*)\}$/, '$1');

  const lowered = unwrapped.toLowerCase();
  const hyphenated = /^[0-9a-f]{32}$/.test(lowered)
    ? `${lowered.slice(0, 8)}-${lowered.slice(8, 12)}-${lowered.slice(12, 16)}-${lowered.slice(16, 20)}-${lowered.slice(20)}`
    : lowered;

  return assertCanonicalUuid(hyphenated, label);
}
