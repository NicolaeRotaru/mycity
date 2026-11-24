import type { Abbonamento, Preventivo } from '@/lib/agenzia/preventivo';
import { leggiSchedaSalvata, type SchedaCliente } from '@/lib/agenzia/scheda-cliente';

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

/**
 * «Accetto: contattatemi» — manda solo QUALE abbonamento: il server ricalcola tutto.
 * Risponde col numero del preventivo.
 */
export async function accettaPreventivo(abbonamento: Abbonamento): Promise<string> {
  const risposta = await fetch('/api/seller/preventivo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ abbonamento }),
  });
  const corpo = (await risposta.json().catch(() => null)) as
    | { ok: true; data: { numero: string } }
    | { ok: false; error?: { message?: string } }
    | null;
  if (!risposta.ok || !corpo || corpo.ok !== true) {
    throw new Error((corpo && corpo.ok === false && corpo.error?.message) || 'Non sono riuscito a inviare la richiesta. Riprova.');
  }
  return corpo.data.numero;
}

// Le frasi dei prezzi vivono accanto al calcolo: le usa anche l'avviso a Nicola, sul server.
export { scriviCanone } from '@/lib/agenzia/preventivo';

/** «22 novembre 2026» da «2026-11-22», senza passare dal fuso del browser. */
export function dataLeggibile(giorno: string): string {
  const [a, m, g] = giorno.split('-').map(Number);
  if (!a || !m || !g) return giorno;
  return new Date(Date.UTC(a, m - 1, g, 12)).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * «Paga e attiva» (24/11/2026) — manda solo la fascia; il server rilegge il canone e apre la cassa
 * Stripe. Risponde con l'indirizzo della cassa, dove la pagina porta il negozio.
 */
export async function pagaAbbonamento(abbonamento: Abbonamento): Promise<string> {
  const risposta = await fetch('/api/seller/preventivo/paga', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ abbonamento }),
  });
  const corpo = (await risposta.json().catch(() => null)) as
    | { ok: true; data: { url: string } }
    | { ok: false; error?: { message?: string } }
    | null;
  if (!risposta.ok || !corpo || corpo.ok !== true || !/^https:\/\//.test(corpo.data.url)) {
    throw new Error((corpo && corpo.ok === false && corpo.error?.message) || 'Non sono riuscito ad aprire il pagamento. Riprova.');
  }
  return corpo.data.url;
}


export const CHIAVE_SCHEDA = ['seller', 'scheda-cliente'] as const;

/**
 * 24/11/2026 — La scheda del locale mandata da n8n (tabella schede_clienti, migrazione 708): la
 * bozza del sito e il piano dei post la usano. La regola di riga lascia leggere al negozio solo la
 * sua. Senza scheda, o se la lettura non riesce, `null`: la bozza resta quella generica.
 */
export async function leggiSchedaDelNegozio(): Promise<SchedaCliente | null> {
  const { supabase } = await import('@/lib/supabase/client');
  const { data: chi } = await supabase.auth.getUser();
  if (!chi.user) return null;
  const { data, error } = await supabase.from('schede_clienti').select('scheda').eq('id_attivita', chi.user.id).maybeSingle();
  if (error || !data) return null;
  return leggiSchedaSalvata((data as { scheda?: unknown }).scheda);
}
