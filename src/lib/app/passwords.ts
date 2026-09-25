import type { CredentialSummary } from '@/lib/credentials';

export type SiteMatch = 'domain' | 'host';

export interface CredentialPayload {
  site: string;
  username: string;
  password: string;
  note?: string;
  urls?: string[];
  match?: SiteMatch;
  extra?: Record<string, unknown>;
}

const KNOWN_FIELDS = new Set(['site', 'username', 'password', 'note', 'urls', 'match']);

export class MalformedCredentialPayloadError extends Error {
  constructor() {
    super('This credential was not written by this app and cannot be displayed.');
    this.name = 'MalformedCredentialPayloadError';
  }
}

export function encodeCredentialPayload(payload: CredentialPayload): string {
  const { site, username, password, note, urls, match, extra } = payload;
  const encoded: Record<string, unknown> = { ...(extra ?? {}), site, username, password };
  if (note !== undefined && note.length > 0) {
    encoded.note = note;
  }
  const others = (urls ?? []).map((url) => url.trim()).filter((url) => url.length > 0);
  if (others.length > 0) {
    encoded.urls = others;
  }
  if (match === 'host') {
    encoded.match = match;
  }
  return JSON.stringify(encoded);
}

export function decodeCredentialPayload(plaintext: string): CredentialPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new MalformedCredentialPayloadError();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MalformedCredentialPayloadError();
  }
  const candidate = parsed as Record<string, unknown>;
  const { site, username, password, note, urls, match } = candidate;

  if (typeof site !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
    throw new MalformedCredentialPayloadError();
  }
  if (note !== undefined && typeof note !== 'string') {
    throw new MalformedCredentialPayloadError();
  }
  if (urls !== undefined && (!Array.isArray(urls) || urls.some((url) => typeof url !== 'string'))) {
    throw new MalformedCredentialPayloadError();
  }
  if (match !== undefined && match !== 'domain' && match !== 'host') {
    throw new MalformedCredentialPayloadError();
  }

  const payload: CredentialPayload = { site, username, password };
  if (note !== undefined) {
    payload.note = note;
  }
  if (urls !== undefined && urls.length > 0) {
    payload.urls = urls as string[];
  }
  if (match !== undefined) {
    payload.match = match;
  }
  const extra = Object.fromEntries(Object.entries(candidate).filter(([key]) => !KNOWN_FIELDS.has(key)));
  if (Object.keys(extra).length > 0) {
    payload.extra = extra;
  }
  return payload;
}

export const UNREADABLE_CREDENTIAL_SITE = 'Unreadable credential';

export const MASKED_PASSWORD = '••••••••';

export interface PasswordRow {
  id: string;
  revisionId: string;
  seq: number;
  site: string;
  username: string;
  password: string;
  note: string;
  changedAt: string;
  readable: boolean;
  payload?: CredentialPayload;
}

export interface OpenedCredential {
  record: CredentialSummary;
  plaintext?: string;
}

export function buildPasswordRows(opened: readonly OpenedCredential[]): PasswordRow[] {
  return opened.map((entry) => toPasswordRow(entry)).sort(bySiteThenUsername);
}

function bySiteThenUsername(a: PasswordRow, b: PasswordRow): number {
  const site = a.site.localeCompare(b.site, undefined, { sensitivity: 'base' });
  return site === 0 ? a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }) : site;
}

function toPasswordRow({ record, plaintext }: OpenedCredential): PasswordRow {
  const row = {
    id: record.credential_id,
    revisionId: record.revision_id,
    seq: record.seq,
    changedAt: record.created_at,
  };

  if (plaintext === undefined) {
    return { ...row, ...unreadable() };
  }

  try {
    const payload = decodeCredentialPayload(plaintext);
    return {
      ...row,
      site: payload.site,
      username: payload.username,
      password: payload.password,
      note: payload.note ?? '',
      readable: true,
      payload,
    };
  } catch {
    return { ...row, ...unreadable() };
  }
}

function unreadable() {
  return {
    site: UNREADABLE_CREDENTIAL_SITE,
    username: '',
    password: '',
    note: '',
    readable: false,
  };
}

export function siteLabel(site: string): string {
  const trimmed = site.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return trimmed;
  }
}
