export const ERROR_CODES = [
  'INVALID_BODY',
  'BAD_REQUEST',
  'INVALID_PARAM',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'INTERNAL_ERROR',
  'NOT_READY',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiErrorCode = ErrorCode | (string & {});

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly endpoint: string;
  readonly allow?: string;

  constructor(params: {
    code: ApiErrorCode;
    status: number;
    endpoint: string;
    allow?: string;
  }) {
    super(`${params.code} (${params.status}) from ${params.endpoint}`);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.endpoint = params.endpoint;
    this.allow = params.allow;
  }

  get isSessionOver(): boolean {
    return this.status === 401 && this.code === 'UNAUTHORIZED';
  }

  get isCredentialFailure(): boolean {
    return this.status === 401 && this.code === 'INVALID_CREDENTIALS';
  }

  get isAuthEndpointRejection(): boolean {
    return this.status === 404 && this.code === 'NOT_FOUND';
  }
}

export class NetworkError extends Error {
  readonly endpoint: string;
  readonly cause?: unknown;

  constructor(endpoint: string, cause?: unknown) {
    super(`network failure calling ${endpoint}`);
    this.name = 'NetworkError';
    this.endpoint = endpoint;
    this.cause = cause;
  }
}

export class RequestTooLargeError extends Error {
  readonly bytes: number;
  readonly limit: number;

  constructor(bytes: number, limit: number) {
    super(`request body is ${bytes} bytes, over the ${limit} byte cap`);
    this.name = 'RequestTooLargeError';
    this.bytes = bytes;
    this.limit = limit;
  }
}
