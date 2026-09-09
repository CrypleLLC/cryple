export function accountInitial(username: string | undefined): string {
  return (username?.trim().charAt(0) ?? '').toUpperCase() || '?';
}
