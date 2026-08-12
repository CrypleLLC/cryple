import { ApiError, NetworkError, RequestTooLargeError, type ApiErrorCode } from './errors';

export const DEFAULT_BASE_URL = 'http://localhost:8080';
export const MAX_BODY_BYTES = 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MIN_TIMEOUT_MS = 2_000;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface PageInfo {
  next_cursor?: string;
  has_more: boolean;
}

export interface ApiResponse<T> {
  status: number;
  message?: string;
  data: T;
  page?: PageInfo;
}

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
  token?: string;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxBodyBytes?: number;
}

export function getBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_BASE_API_URL?.trim();
  const base = configured && configured.length > 0 ? configured : DEFAULT_BASE_URL;
  return base.replace(/\/+$/, '');
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${getBaseUrl()}${normalized}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

function serializeBody(body: unknown, limit: number): string | undefined {
  if (body === undefined) {
    return undefined;
  }
  const serialized = JSON.stringify(body);
  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes > limit) {
    throw new RequestTooLargeError(bytes, limit);
  }
  return serialized;
}

function resolveSignal(
  timeoutMs: number,
  caller?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(timeoutMs, MIN_TIMEOUT_MS));
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

export async function request<T = unknown>(
  options: RequestOptions,
): Promise<ApiResponse<T>> {
  const {
    method,
    path,
    body,
    token,
    query,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    maxBodyBytes = MAX_BODY_BYTES,
  } = options;

  const endpoint = `${method} ${path}`;
  const url = buildUrl(path, query);
  const serialized = serializeBody(body, maxBodyBytes);

  const headers: Record<string, string> = {};
  if (serialized !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: serialized,
      signal: resolveSignal(timeoutMs, signal),
    });
  } catch (error) {
    throw new NetworkError(endpoint, error);
  }

  if (response.status === 204) {
    return { status: 204, data: undefined as T };
  }

  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw.length > 0 ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const code =
      typeof parsed === 'object' && parsed !== null && 'code' in parsed
        ? ((parsed as { code: unknown }).code as ApiErrorCode)
        : fallbackCode(response.status);

    throw new ApiError({
      code,
      status: response.status,
      endpoint,
      allow: response.headers.get('Allow') ?? undefined,
    });
  }

  const envelope = (parsed ?? {}) as {
    message?: string;
    data?: T;
    page?: PageInfo;
  };

  return {
    status: response.status,
    message: envelope.message,
    data: envelope.data as T,
    page: envelope.page,
  };
}

function fallbackCode(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return 'INVALID_BODY';
    case 401:
      return 'UNAUTHORIZED';
    case 404:
      return 'NOT_FOUND';
    case 405:
      return 'METHOD_NOT_ALLOWED';
    case 409:
      return 'CONFLICT';
    case 503:
      return 'NOT_READY';
    default:
      return 'INTERNAL_ERROR';
  }
}
