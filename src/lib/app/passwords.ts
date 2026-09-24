import type { CredentialSummary } from '@/lib/credentials';

export interface CredentialPayload {
  site: string;
  username: string;
  password: string;
  note?: string;
}

export class MalformedCredentialPayloadError extends Error {
  constructor() {
    super('This credential was not written by this app and cannot be displayed.');
    this.name = 'MalformedCredentialPayloadError';
  }
}

export function encodeCredentialPayload(payload: CredentialPayload): string {
  const { site, username, password, note } = payload;
  return JSON.stringify(note === undefined || note.length === 0
    ? { site, username, password }
    : { site, username, password, note });
}

export function decodeCredentialPayload(plaintext: string): CredentialPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new MalformedCredentialPayloadError();
  }

  const candidate = parsed as Partial<CredentialPayload> | null;
  const { site, username, password, note } = candidate ?? {};

  if (typeof site !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
    throw new MalformedCredentialPayloadError();
  }
  if (note !== undefined && typeof note !== 'string') {
    throw new MalformedCredentialPayloadError();
  }

  return note === undefined ? { site, username, password } : { site, username, password, note };
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
