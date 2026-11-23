import type { Preventivo } from '@/lib/agenzia/preventivo';

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

// Le frasi dei prezzi vivono accanto al calcolo: le usa anche l'avviso a Nicola, sul server.
export { scriviPrezzo, scriviTotale } from '@/lib/agenzia/preventivo';

/** «22 novembre 2026» da «2026-11-22», senza passare dal fuso del browser. */
export function dataLeggibile(giorno: string): string {
  const [a, m, g] = giorno.split('-').map(Number);
  if (!a || !m || !g) return giorno;
  return new Date(Date.UTC(a, m - 1, g, 12)).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
