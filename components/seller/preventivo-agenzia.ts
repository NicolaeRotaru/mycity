import type { Cadenza, Preventivo, Prezzo, Totale } from '@/lib/agenzia/preventivo';
import { formatPriceFromCents } from '@/lib/format';

/**
 * Le letture del preventivo dal browser, in un posto solo: la pagina e il
 * riquadro della dashboard chiedono la stessa cosa allo stesso indirizzo, e
 * scrivono i prezzi nello stesso modo.
 */

export const CHIAVE_PREVENTIVO = ['seller', 'preventivo-agenzia'] as const;

export async function leggiPreventivoAgenzia(): Promise<Preventivo> {
  const risposta = await fetch('/api/seller/preventivo', { cache: 'no-store' });
  const corpo = (await risposta.json().catch(() => null)) as
    | { ok: true; data: Preventivo }
    | { ok: false; error?: { message?: string } }
    | null;
  if (!risposta.ok || !corpo || corpo.ok !== true) {
    const messaggio = corpo && corpo.ok === false ? corpo.error?.message : undefined;
    throw new Error(messaggio ?? 'Non sono riuscito a leggere il preventivo.');
  }
  return corpo.data;
}

const DOPO: Record<Cadenza, string> = { una_tantum: '', mese: ' al mese' };

/** «500,00 €», «300,00 € al mese», «da 50,00 a 300,00 € al mese», «su richiesta». */
export function scriviPrezzo(prezzo: Prezzo | null, cadenza: Cadenza): string {
  if (!prezzo) return 'su richiesta';
  if (prezzo.da === prezzo.a) return `${formatPriceFromCents(prezzo.da)}${DOPO[cadenza]}`;
  return `da ${formatPriceFromCents(prezzo.da)} a ${formatPriceFromCents(prezzo.a)}${DOPO[cadenza]}`;
}

/** Un totale: la parte coi prezzi, più «+ Logo e grafica su richiesta» per le voci senza prezzo. */
export function scriviTotale(t: Totale, cadenza: Cadenza): string {
  const conPrezzo = t.da > 0 || t.a > 0 ? scriviPrezzo({ da: t.da, a: t.a }, cadenza) : '';
  const senza = t.suRichiesta.length > 0 ? `${t.suRichiesta.join(', ')} su richiesta` : '';
  return conPrezzo && senza ? `${conPrezzo} + ${senza}` : conPrezzo || senza || scriviPrezzo({ da: 0, a: 0 }, cadenza);
}

/** «22 novembre 2026» da «2026-11-22», senza passare dal fuso del browser. */
export function dataLeggibile(giorno: string): string {
  const [a, m, g] = giorno.split('-').map(Number);
  if (!a || !m || !g) return giorno;
  return new Date(Date.UTC(a, m - 1, g, 12)).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
