/**
 * Tiny className utility — no dipendenza esterna.
 * Filtra falsy values e unisce con spazio.
 *
 * Uso: cn('btn', isActive && 'btn-active', className)
 */
export function cn(...classes: (string | false | null | undefined | 0)[]): string {
  return classes.filter(Boolean).join(' ');
}
