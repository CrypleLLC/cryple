export const TEXT_SECURITY_CLASS = '[-webkit-text-security:disc]';

export const PASSWORD_MANAGER_IGNORE = {
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

export const SECRET_FIELD_COPY = {
  show: 'Show value',
  hide: 'Hide value',
} as const;

export type SecretInputAttributes = typeof PASSWORD_MANAGER_IGNORE & {
  type: 'text' | 'password';
  autoComplete: 'off';
  className?: string;
};

export function secretInputAttributes(masked: boolean, cssMasking: boolean): SecretInputAttributes {
  if (!masked) {
    return { type: 'text', autoComplete: 'off', ...PASSWORD_MANAGER_IGNORE };
  }
  if (cssMasking) {
    return { type: 'text', autoComplete: 'off', className: TEXT_SECURITY_CLASS, ...PASSWORD_MANAGER_IGNORE };
  }
  return { type: 'password', autoComplete: 'off', ...PASSWORD_MANAGER_IGNORE };
}

export interface CssSupports {
  supports(property: string, value: string): boolean;
}

export function supportsTextSecurity(
  css: CssSupports | undefined = typeof CSS === 'undefined' ? undefined : CSS,
): boolean {
  try {
    return css?.supports('-webkit-text-security', 'disc') ?? false;
  } catch {
    return false;
  }
}
