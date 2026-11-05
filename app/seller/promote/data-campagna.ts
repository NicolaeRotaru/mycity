/**
 * Le date delle campagne all'ora di Piacenza, non del telefono: «dal 3 al 9
 * novembre» deve leggersi uguale anche su un telefono rimasto col fuso di un viaggio.
 */
export function dataDellaCampagna(d: string | Date): string {
  return new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
}
