import type { Abbonamento, Preventivo } from '@/lib/agenzia/preventivo';
import { leggiSchedaSalvata, type SchedaCliente } from '@/lib/agenzia/scheda-cliente';
import type { Canale, Canali } from '@/lib/agenzia/canali';
import { leggiAnalisiCanali, leggiRisultatoSito, type AnalisiCanali, type RisultatoSito } from '@/lib/agenzia/analisi';
import { leggiBozzaSalvata, type BozzaSitoAd } from '@/lib/agenzia/bozza-sito-ad';

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
    throw new Error(messaggio ?? 'Non sono riuscito a leggere la tua vetrina per i servizi.');
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
 * bozza del sito e il piano dei post la usano. Dal 25/11 passa dal server (/api/seller/scheda-cliente):
 * finché il negozio non è abbonato arriva solo l'analisi, senza i campi (Nicola: la scheda nasce dopo
 * l'abbonamento). Senza scheda, o se la lettura non riesce, `null`: la bozza resta quella generica.
 */
export async function leggiSchedaDelNegozio(): Promise<SchedaCliente | null> {
  const r = await fetch('/api/seller/scheda-cliente', { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: { scheda?: unknown } } | null;
  if (!corpo?.ok || !corpo.data?.scheda) return null;
  return leggiSchedaSalvata(corpo.data.scheda);
}

/**
 * 26/11/2026 — La scheda e se il negozio ha pagato, dalla STESSA risposta (revisione di mycity#336: con due chiamate
 * un Premium vedeva «Scegli l'abbonamento» mentre la seconda caricava, e per sempre se falliva). Se la lettura non
 * riesce l'errore sale a chi chiama: la pagina lo dice, invece di trattare il negozio come non abbonato.
 */
export const CHIAVE_SCHEDA_E_APERTA = ['seller', 'scheda-e-abbonamento'] as const;
export async function leggiSchedaEAperta(): Promise<{ scheda: SchedaCliente | null; aperta: boolean }> {
  const r = await fetch('/api/seller/scheda-cliente', { cache: 'no-store' });
  if (!r.ok) throw new Error('La scheda non si è letta.');
  const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: { scheda?: unknown; aperta?: unknown } } | null;
  if (!corpo?.ok) throw new Error('La scheda non si è letta.');
  return { scheda: corpo.data?.scheda ? leggiSchedaSalvata(corpo.data.scheda) : null, aperta: corpo.data?.aperta === true };
}

/* ───────────── 24/11/2026 — L'analisi del business e la bozza del sito dell'AD ───────────── */


export const CHIAVE_ANALISI = ['seller', 'analisi-del-negozio'] as const;
export const CHIAVE_CANALI = ['seller', 'canali'] as const;
export const CHIAVE_BOZZA_AD = ['seller', 'bozza-sito-ad'] as const;

export type AnalisiDelNegozio = {
  sito: RisultatoSito | null;
  canali: AnalisiCanali | null;
  canaliRichiestiIl: string | null;
};

/** L'analisi del negozio (migrazione 711): la regola di riga fa leggere solo la sua. Senza, tutto `null`. */
export async function leggiAnalisiDelNegozio(): Promise<AnalisiDelNegozio> {
  const vuota: AnalisiDelNegozio = { sito: null, canali: null, canaliRichiestiIl: null };
  const { supabase } = await import('@/lib/supabase/client');
  const { data: chi } = await supabase.auth.getUser();
  if (!chi.user) return vuota;
  const { data, error } = await supabase
    .from('analisi_negozi')
    .select('sito, canali, canali_richiesti_il, canali_il')
    .eq('id_attivita', chi.user.id)
    .maybeSingle();
  if (error || !data) return vuota;
  const r = data as { sito: unknown; canali: unknown; canali_richiesti_il: string | null; canali_il: string | null };
  const inAttesa = r.canali_richiesti_il && (!r.canali_il || new Date(r.canali_richiesti_il) > new Date(r.canali_il));
  return { sito: leggiRisultatoSito(r.sito), canali: leggiAnalisiCanali(r.canali), canaliRichiestiIl: inAttesa ? r.canali_richiesti_il : null };
}

/** La bozza del sito scritta dall'AD, se c'è (migrazione 711). */
export async function leggiBozzaDellAd(): Promise<BozzaSitoAd | null> {
  const { supabase } = await import('@/lib/supabase/client');
  const { data: chi } = await supabase.auth.getUser();
  if (!chi.user) return null;
  const { data, error } = await supabase.from('bozze_sito').select('bozza').eq('id_attivita', chi.user.id).maybeSingle();
  if (error || !data) return null;
  return leggiBozzaSalvata((data as { bozza?: unknown }).bozza);
}

export async function leggiCanali(): Promise<Canali> {
  const r = await fetch('/api/seller/canali', { cache: 'no-store' });
  const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: { canali: Canali }; error?: { message?: string } } | null;
  if (!r.ok || !corpo?.ok || !corpo.data) throw new Error(corpo?.error?.message ?? 'Non sono riuscito a leggere i tuoi canali.');
  return corpo.data.canali;
}

export class ErroreCanali extends Error {
  constructor(message: string, readonly errori: Partial<Record<Canale, string>>) {
    super(message);
  }
}

export async function salvaCanali(canali: Canali): Promise<{ canali: Canali; analisiChiesta: boolean }> {
  const r = await fetch('/api/seller/canali', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(canali) });
  const corpo = (await r.json().catch(() => null)) as
    | { ok: true; data: { canali: Canali; analisiChiesta: boolean } }
    | { ok: false; error?: { message?: string; details?: { errori?: Partial<Record<Canale, string>> } } }
    | null;
  if (!r.ok || !corpo || corpo.ok !== true) {
    const e = corpo && corpo.ok === false ? corpo.error : undefined;
    throw new ErroreCanali(e?.message ?? 'Non sono riuscito a salvare. Riprova.', e?.details?.errori ?? {});
  }
  return corpo.data;
}

export async function analizzaIlSito(): Promise<{ sito: RisultatoSito; giaFattaOggi: boolean }> {
  const r = await fetch('/api/seller/analisi-sito', { method: 'POST' });
  const corpo = (await r.json().catch(() => null)) as
    | { ok: true; data: { sito: RisultatoSito; giaFattaOggi: boolean } }
    | { ok: false; error?: { message?: string } }
    | null;
  if (!r.ok || !corpo || corpo.ok !== true) {
    throw new Error((corpo && corpo.ok === false && corpo.error?.message) || 'L’analisi del sito non è riuscita. Riprova fra poco.');
  }
  return corpo.data;
}

/* ───────────── 24/11/2026 — La pagella del negozio (la logica del flusso 18) ───────────── */

export const CHIAVE_PAGELLA = ['seller', 'pagella'] as const;

/**
 * 25/11/2026 — La pagella arriva solo dopo l'abbonamento (Nicola): per chi è in demo il server risponde
 * `{ disponibile: false }` e qui diventa `null`, cioè «nessuna pagella da mostrare».
 */
export async function leggiPagella(): Promise<import('@/lib/agenzia/pagella').Pagella | null> {
  const r = await fetch('/api/seller/pagella', { cache: 'no-store' });
  const corpo = (await r.json().catch(() => null)) as
    | { ok?: boolean; data?: import('@/lib/agenzia/pagella').Pagella | { disponibile: false }; error?: { message?: string } }
    | null;
  if (!r.ok || !corpo?.ok || !corpo.data) throw new Error(corpo?.error?.message ?? 'Non sono riuscito a preparare la pagella.');
  if ('disponibile' in corpo.data) return null;
  return corpo.data;
}

/* ───────────── 27/11/2026 — Il lavoro Premium già consegnato (solo SDG, per ora) ───────────── */

export const CHIAVE_LAVORO_CONSEGNATO = ['seller', 'lavoro-consegnato'] as const;

/**
 * Il lavoro consegnato del negozio (`lavoro`, i clienti scritti a mano) e quello nato col suo ordine di SDG (`ordine`,
 * 28/11/2026), o `null` se non ne ha. Se la lettura non riesce l'errore sale: la pagina torna quella di sempre.
 */
export type LetturaLavoro = {
  lavoro: import('@/lib/agenzia/lavoro-consegnato/tipi').LavoroConsegnato | null;
  ordine: import('@/lib/agenzia/lavoro-dell-ordine').LavoroDellOrdine | null;
};
export async function leggiLavoroConsegnato(): Promise<LetturaLavoro> {
  // Collaudo 27/11: senza un tempo massimo una rotta lenta teneva TUTTI i venditori sul caricamento. Dopo 5 secondi
  // l'errore riporta la pagina al preventivo di sempre.
  const r = await fetch('/api/seller/lavoro-consegnato', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
  const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: { lavoro?: unknown; ordine?: unknown } } | null;
  if (!r.ok || !corpo?.ok) throw new Error('Non sono riuscito a leggere il lavoro consegnato.');
  return {
    lavoro: (corpo.data?.lavoro ?? null) as LetturaLavoro['lavoro'],
    ordine: (corpo.data?.ordine ?? null) as LetturaLavoro['ordine'],
  };
}
