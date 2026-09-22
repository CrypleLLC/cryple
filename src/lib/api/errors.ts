export const ERROR_CODES = [
  'INVALID_BODY',
  'BAD_REQUEST',
  'INVALID_PARAM',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'INVALID_BATCH',
  'STALE_KEY_GENERATION',
  'TOO_MANY_DEVICES',
  'TOO_MANY_REQUESTS',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'NOT_READY',
  'QUOTA_EXCEEDED',
  'USERNAME_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiErrorCode = ErrorCode | (string & {});

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly endpoint: string;
  readonly allow?: string;
  readonly retryAfterSeconds?: number;

  constructor(params: {
    code: ApiErrorCode;
    status: number;
    endpoint: string;
    allow?: string;
    retryAfterSeconds?: number;
  }) {
    super(`${params.code} (${params.status}) from ${params.endpoint}`);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.endpoint = params.endpoint;
    this.allow = params.allow;
    this.retryAfterSeconds = params.retryAfterSeconds;
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

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isStaleKeyGeneration(): boolean {
    return this.status === 409 && this.code === 'STALE_KEY_GENERATION';
  }

  get isTooManyDevices(): boolean {
    return this.status === 409 && this.code === 'TOO_MANY_DEVICES';
  }

  get isInvalidBatch(): boolean {
    return this.status === 400 && this.code === 'INVALID_BATCH';
  }

  get isQuotaExceeded(): boolean {
    return this.status === 507;
  }

  get isObjectTooLarge(): boolean {
    return this.status === 413;
  }

  get isUsernameUnavailable(): boolean {
    return this.status === 422 && this.code === 'USERNAME_UNAVAILABLE';
  }

  get isDriveDisabled(): boolean {
    return this.status === 404 && this.endpoint.includes('/files');
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
