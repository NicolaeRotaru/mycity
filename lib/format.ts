export const formatPrice = (n: number | string) => `€${Number(n).toFixed(2)}`;

export const formatDate = (date: string | Date) =>
  new Date(date).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
