import { ApiError } from './errors';

export const GENERIC_AUTH_FAILURE =
  'We could not sign you in. Check your recovery phrase and PIN, then try again.';

export const SESSION_ENDED = 'This device was signed out. Unlock it again to carry on.';

export const DEVICE_REMOVED =
  'This browser is no longer a device of your account: it was removed, or the account was ' +
  'deleted. Enter your recovery phrase to add it again.';

export const STALE_KEYS =
  'Your keys changed on another device while this was being saved. Nothing was saved. Try again.';

export const TOO_MANY_DEVICES =
  'Your account already has as many devices as it can hold. Remove one of them first.';

export const DEVICE_CHANGE_REFUSED =
  'The server refused this change to your devices, and nothing was changed. Reload and try again.';

export const SCOPE_MISSING =
  'This device cannot open that kind of item. Open it from a device that holds it.';

export const SERVICE_BUSY =
  'The server could not check this request right now, and nothing was done. Try again in a moment.';

export function rateLimitMessage(retryAfterSeconds: number | undefined): string {
  const wait = describeWait(retryAfterSeconds);
  return (
    `Too many requests have come from this network, so the server is pausing them. ` +
    `This is not a problem with your account or your PIN. Try again ${wait}.`
  );
}

export function describeWait(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0) {
    return 'in a moment';
  }
  if (seconds < 60) {
    return seconds === 1 ? 'in 1 second' : `in ${seconds} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'in about a minute' : `in about ${minutes} minutes`;
}

const SCOPED_PATHS: readonly (readonly [string, string])[] = [
  ['/secrets', 'secrets'],
  ['/notes', 'notes'],
  ['/documents', 'documents'],
  ['/files', 'files'],
  ['/connections', 'sharing'],
  ['/sharing', 'sharing'],
];

export function scopeForPath(path: string): string | undefined {
  for (const [prefix, scope] of SCOPED_PATHS) {
    if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)) {
      return scope;
    }
  }
  return undefined;
}

export interface MessageOptions {
  deviceScopes?: readonly string[];
}

export const GENERIC_FAILURE = 'Something went wrong. Please try again.';

const AUTH_ENDPOINTS = new Set([
  '/sign-up',
  '/sign-in',
  '/auth/verify',
  '/devices/enrol',
  '/devices/enrol/chain',
]);

function pathOf(endpoint: string): string {
  const parts = endpoint.split(' ');
  return parts.length > 1 ? parts[1] : endpoint;
}

export const STORAGE_FULL =
  'There is no room left in your storage for this file. Deleting a file frees its space within a minute.';

export const OBJECT_TOO_LARGE = 'That file is larger than a single upload allows.';

export const USERNAME_UNAVAILABLE = 'That username is unavailable. Choose another one.';

export const USERNAME_MALFORMED =
  'A username is 3 to 64 characters — lowercase letters and numbers, with dots, underscores or ' +
  'hyphens between them, starting and ending with a letter or a number.';

export const USERNAME_NOT_IN_USE = 'No account is using that username right now.';

export function userMessageFor(error: ApiError, options: MessageOptions = {}): string {
  const path = pathOf(error.endpoint);

  if (error.isRateLimited) {
    return rateLimitMessage(error.retryAfterSeconds);
  }
  if (error.isStaleKeyGeneration) {
    return STALE_KEYS;
  }
  if (error.isTooManyDevices) {
    return TOO_MANY_DEVICES;
  }
  if (error.isInvalidBatch) {
    return DEVICE_CHANGE_REFUSED;
  }
  if (error.status === 503 && error.code === 'SERVICE_UNAVAILABLE') {
    return SERVICE_BUSY;
  }

  if (AUTH_ENDPOINTS.has(path) && error.status === 404) {
    return GENERIC_AUTH_FAILURE;
  }

  if (error.isQuotaExceeded) {
    return STORAGE_FULL;
  }
  if (error.isObjectTooLarge) {
    return OBJECT_TOO_LARGE;
  }
  if (error.isUsernameUnavailable) {
    return USERNAME_UNAVAILABLE;
  }
  if (path === '/users/username' && error.code === 'INVALID_PARAM') {
    return USERNAME_MALFORMED;
  }
  if (path === '/users/resolve' && error.status === 404) {
    return USERNAME_NOT_IN_USE;
  }
  if (error.status === 404 && options.deviceScopes !== undefined) {
    const scope = scopeForPath(path);
    if (scope !== undefined && !options.deviceScopes.includes(scope)) {
      return SCOPE_MISSING;
    }
  }

  switch (error.code) {
    case 'UNAUTHORIZED':
      return SESSION_ENDED;
    case 'INVALID_CREDENTIALS':
      return 'We could not verify that request. Check your PIN and try again.';
    case 'NOT_FOUND':
      return 'That item no longer exists.';
    case 'CONFLICT':
      return 'That request is no longer in a state that can be completed.';
    case 'INVALID_PARAM':
    case 'INVALID_BODY':
    case 'BAD_REQUEST':
      return GENERIC_FAILURE;
    case 'METHOD_NOT_ALLOWED':
      return GENERIC_FAILURE;
    case 'INTERNAL_ERROR':
      return 'The server had a problem. Please try again in a moment.';
    default:
      return GENERIC_FAILURE;
  }
}
