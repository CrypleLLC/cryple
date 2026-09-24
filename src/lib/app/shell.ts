export function accountInitial(username: string | undefined): string {
  return (username?.trim().charAt(0) ?? '').toUpperCase() || '?';
}

export const SIDEBAR_INSET = 'md:left-64';

export const CONTENT_GUTTER = 'px-4 md:px-6';

export const FLOATING_SPREAD_GUTTER = 'px-18';

export function contentMeasure(miniatures: boolean): string {
  return miniatures ? 'max-w-none' : 'max-w-6xl';
}
