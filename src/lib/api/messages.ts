import { ApiError } from './errors';

export const GENERIC_AUTH_FAILURE =
  'We could not sign you in. Check your recovery phrase and PIN, then try again.';

export const GENERIC_FAILURE = 'Something went wrong. Please try again.';

const AUTH_ENDPOINTS = new Set(['/sign-up', '/sign-in', '/auth/verify']);

function pathOf(endpoint: string): string {
  const parts = endpoint.split(' ');
  return parts.length > 1 ? parts[1] : endpoint;
}

export function userMessageFor(error: ApiError): string {
  const path = pathOf(error.endpoint);

  if (AUTH_ENDPOINTS.has(path) && error.status === 404) {
    return GENERIC_AUTH_FAILURE;
  }

  switch (error.code) {
    case 'UNAUTHORIZED':
      return 'Your session has expired. Please sign in again.';
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
