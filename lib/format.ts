export const formatPrice = (n: number | string) => `€${Number(n).toFixed(2)}`;

export const formatDate = (date: string | Date) =>
  new Date(date).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

/**
 * Pluralizzatore italiano semplice (singolare/plurale).
 * Per casi più complessi (zero, due, molti) usa Intl.PluralRules.
 */
export function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
