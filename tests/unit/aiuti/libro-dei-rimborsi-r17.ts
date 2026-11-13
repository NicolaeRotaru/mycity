import { fintoDatabase, type FintoDatabase, type Riga } from './finto-database-dei-pagamenti';

/**
 * R17 (13/11/2026) — Il libro dei rimborsi come lo scrive la migrazione 412, e Stripe finto.
 *
 * Il database finto (`finto-database-dei-pagamenti`) applica i filtri delle scritture; qui sopra le
 * funzioni del libro fanno quello che fa la 412:
 *  · `accumula_rimborso` somma col tetto del lordo; con `p_chiave` la stessa chiave sullo stesso
 *    ordine si somma una volta sola e la risposta dice `prenotazione`: 'nuova', 'in_corso' (presa
 *    meno di 10 minuti fa), 'ripresa' (presa prima: la prende questo tentativo), 'altra_cifra';
 *  · `storna_rimborso` con la chiave toglie solo la prenotazione di quella chiave, se c'è;
 *  · `rimborso_gia_prenotato` dice se la chiave ha la sua prenotazione.
 * Con `senza412` il database è quello di prima: le chiamate con la chiave rispondono PGRST202
 * («funzione non trovata»), come PostgREST, e quelle senza chiave sommano e tolgono come la 161.
 * L'orologio è `Date.now()`: le prove lo fermano con `vi.setSystemTime`.
 *
 * Stripe finto: con la stessa chiave risponde lo stesso rimborso (24 ore, finché `chiaviScadute`
 * è falso); `create` e `list` si possono far aspettare (una risposta lenta) o non rispondere mai
 * (il processo che muore lì dentro).
 */

export const DIECI_MINUTI = 10 * 60_000;

export type PrenotazioneDelLibro = { order_id: string; chiave: string; centesimi: number; preso_il: number };

export interface Libro {
  db: FintoDatabase;
  prenotazioni: PrenotazioneDelLibro[];
  /** Il database non ha ancora la 412. */
  senza412: boolean;
  client: FintoDatabase['client'] & {
    auth: { admin: { getUserById: (id: string) => Promise<{ data: { user: { email: string } }; error: null }> } };
  };
}

export function creaLibro(tabelle: Record<string, Riga[]>): Libro {
  const db = fintoDatabase(tabelle);
  const libro: Libro = {
    db,
    prenotazioni: [],
    senza412: false,
    client: {
      ...db.client,
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@esempio.it` } }, error: null }) } },
    },
  };
  const ordine = (id: unknown) => (db.tabelle.orders ?? []).find((o) => o.id === id);
  const nonTrovata = (nome: string) => ({
    data: null,
    error: { code: 'PGRST202', message: `Could not find the function public.${nome} in the schema cache` },
  });
  const diQuesta = (id: unknown, chiave: unknown) => (p: PrenotazioneDelLibro) => p.order_id === id && p.chiave === chiave;

  db.rispostaRpc = (nome, a) => {
    if (nome === 'accumula_rimborso') {
      const chiave = a.p_chiave == null ? null : String(a.p_chiave);
      if (chiave != null && libro.senza412) return nonTrovata(nome);
      const o = ordine(a.p_order_id);
      if (!o) return { data: null, error: { code: 'P0002', message: 'accumula_rimborso: ordine inesistente' } };
      const tot = typeof o.gross_total_cents === 'number' ? o.gross_total_cents : Math.round(Number(o.total_price ?? 0) * 100);
      const ora = Number(o.refunded_amount_cents ?? 0);
      const delta = Number(a.p_delta);
      if (chiave != null) {
        const p = libro.prenotazioni.find(diQuesta(o.id, chiave));
        if (p) {
          const risposta = (prenotazione: string) => ({ data: [{ totale_rimborsato: ora, totale_ordine: tot, prenotazione }], error: null });
          if (p.centesimi !== delta) return risposta('altra_cifra');
          if (p.preso_il > Date.now() - DIECI_MINUTI) return risposta('in_corso');
          p.preso_il = Date.now();
          return risposta('ripresa');
        }
      }
      const nuovo = ora + delta;
      if (nuovo > tot) return { data: [], error: null };
      o.refunded_amount_cents = nuovo;
      if (chiave != null) libro.prenotazioni.push({ order_id: String(o.id), chiave, centesimi: delta, preso_il: Date.now() });
      return {
        data: [{ totale_rimborsato: nuovo, totale_ordine: tot, ...(libro.senza412 ? {} : { prenotazione: 'nuova' }) }],
        error: null,
      };
    }
    if (nome === 'storna_rimborso') {
      const chiave = a.p_chiave == null ? null : String(a.p_chiave);
      if (chiave != null && libro.senza412) return nonTrovata(nome);
      const o = ordine(a.p_order_id);
      if (!o) return { data: null, error: { code: 'P0002', message: 'storna_rimborso: ordine inesistente' } };
      let tolti = Number(a.p_delta);
      if (chiave != null) {
        const i = libro.prenotazioni.findIndex(diQuesta(o.id, chiave));
        if (i < 0) return { data: Number(o.refunded_amount_cents ?? 0), error: null };
        tolti = libro.prenotazioni[i].centesimi;
        libro.prenotazioni.splice(i, 1);
      }
      o.refunded_amount_cents = Math.max(0, Number(o.refunded_amount_cents ?? 0) - tolti);
      return { data: o.refunded_amount_cents, error: null };
    }
    if (nome === 'rimborso_gia_prenotato') {
      if (libro.senza412) return nonTrovata(nome);
      return { data: libro.prenotazioni.some(diQuesta(a.p_order_id, a.p_chiave)), error: null };
    }
    return { data: null, error: null };
  };
  return libro;
}

export type RimborsoSuStripe = {
  id: string;
  amount: number;
  status: string;
  metadata: Record<string, string>;
  chiave: string | null;
};

export interface StripeFinto {
  suStripe: RimborsoSuStripe[];
  /** Gli importi dei rimborsi creati davvero (i soldi usciti). */
  creati: number[];
  /** Gli storni al negozio, uno per chiave. */
  storni: Array<{ amount: number; chiave: string }>;
  /** Passate le 24 ore: Stripe non ricorda più le chiavi. */
  chiaviScadute: boolean;
  /** La prossima `create` non risponde mai e non arriva a Stripe: il processo muore lì. */
  createMuore: boolean;
  /** La prossima `create` crea il rimborso e poi la risposta si perde. */
  rispostaPersa: boolean;
  /** La prossima `create` la rifiuta Stripe: niente esce. */
  createRifiutata: boolean;
  /** La prossima `create` aspetta questa promessa prima di arrivare a Stripe (una richiesta lenta). */
  createLenta: Promise<void> | null;
  /** La prossima `list` fotografa i rimborsi adesso e risponde quando questa promessa si scioglie. */
  listLenta: Promise<void> | null;
  client: () => unknown;
}

export function creaStripe(): StripeFinto {
  const s: StripeFinto = {
    suStripe: [],
    creati: [],
    storni: [],
    chiaviScadute: false,
    createMuore: false,
    rispostaPersa: false,
    createRifiutata: false,
    createLenta: null,
    listLenta: null,
    client: () => ({
      refunds: {
        create: async (p: { amount: number; metadata?: Record<string, string> }, o: { idempotencyKey: string }) => {
          const lenta = s.createLenta;
          s.createLenta = null;
          if (lenta) await lenta;
          if (s.createMuore) {
            s.createMuore = false;
            return new Promise(() => {});
          }
          if (s.createRifiutata) {
            s.createRifiutata = false;
            throw new Error('Your card was declined');
          }
          const gia = s.chiaviScadute ? null : s.suStripe.find((r) => r.chiave === o.idempotencyKey);
          if (gia) return { ...gia };
          s.creati.push(p.amount);
          const nuovo = { id: `re_${s.suStripe.length + 1}`, amount: p.amount, status: 'succeeded', metadata: { ...(p.metadata ?? {}) }, chiave: o.idempotencyKey };
          s.suStripe.push(nuovo);
          if (s.rispostaPersa) {
            s.rispostaPersa = false;
            throw new Error('socket hang up');
          }
          return { ...nuovo };
        },
        list: async () => {
          const foto = { data: [...s.suStripe].reverse().map((r) => ({ ...r, metadata: { ...r.metadata } })), has_more: false };
          const attesa = s.listLenta;
          s.listLenta = null;
          if (attesa) await attesa;
          return foto;
        },
      },
      transfers: {
        createReversal: async (_t: string, p: { amount: number }, o: { idempotencyKey: string }) => {
          if (!s.storni.some((x) => x.chiave === o.idempotencyKey)) s.storni.push({ amount: p.amount, chiave: o.idempotencyKey });
          return { id: `trr_${o.idempotencyKey}` };
        },
      },
    }),
  };
  return s;
}

/** Un ordine con la carta, consegnato, col bonifico al negozio già partito. */
export function ordineConCarta(extra: Riga = {}): Riga {
  return {
    id: 'o1', user_id: 'cliente1', seller_id: 'negozio1',
    total_price: 40, gross_total_cents: 4000, refunded_amount_cents: 0,
    payment_method: 'card', payment_status: 'PAID', delivery_status: 'DELIVERED',
    payout_status: 'TRANSFERRED', seller_payout_cents: 3600, seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1', stripe_transfer_id: 'tr_1', stripe_reversal_id: null, stripe_refund_id: null,
    internal_dispute_status: null, wallet_applied_cents: 0,
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0, rider_fee_cents: null,
    shipping_cost: 0,
    ...extra,
  };
}
