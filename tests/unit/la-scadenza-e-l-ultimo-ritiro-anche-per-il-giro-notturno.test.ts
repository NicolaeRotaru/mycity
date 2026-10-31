import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ancoraNeiTempi, rigaScadenzaPerIlNegozio } from '@/lib/ordini/scadenza-accettazione';

/**
 * 30/10/2026 (ondata 24) — LA SCADENZA È L'ULTIMO RITIRO, PER IL NEGOZIO E PER IL GIRO NOTTURNO.
 *
 * Lunedì alle 12:00 Pane Quotidiano (lun-sab 9-13 e 16:30-19:30, giovedì pomeriggio e domenica
 * chiuso) riceve un ordine per «Oggi · 13:00–16:30». Il forno chiude alle 13 e riapre alle 16:30,
 * a fascia finita: la spesa si ritira entro le 12:45. Prima il negozio leggeva «entro le 16:30» e
 * il giro notturno (che gli orari non li leggeva) teneva vivo l'ordine fino alle 16:30: il cliente
 * aspettava quasi quattro ore un ordine che nessuno poteva più ritirare.
 *
 * La regola (scelta dell'AD, coi 60 minuti): la scadenza è SEMPRE l'ultimo momento utile per il
 * ritiro, anche col negozio aperto per tutta la fascia (la fine meno 60 minuti); senza un momento
 * per il ritiro la riga lo dice e l'ordine scade. Il giro notturno passa dalla rotta vera, con gli
 * orari che arrivano dal database (la finta risponde con il negozio solo se la lettura lo chiede).
 */

const { ORARI_PQ } = vi.hoisted(() => {
  const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
  return {
    ORARI_PQ: { mon: giorno, tue: giorno, wed: giorno, thu: [['09:00', '13:00']], fri: giorno, sat: giorno, sun: [] },
  };
});

/** Lunedì 2/11/2026, ora di Roma (UTC+1). */
const roma = (h: number, m = 0, s = 0) => new Date(Date.UTC(2026, 10, 2, h - 1, m, s));
const ordine = (nato: Date, fascia: string) => ({ created_at: nato.toISOString(), delivery_slot: fascia });
const riga = (nato: Date, fascia: string, adesso: Date = nato) =>
  rigaScadenzaPerIlNegozio(ordine(nato, fascia), adesso, ORARI_PQ);

describe('la riga al negozio dice l’ultimo ritiro possibile', () => {
  it('caso 1 — lunedì 12:00, «Oggi · 13:00–16:30»: entro le 12:45', () => {
    expect(riga(roma(12), 'Oggi · 13:00–16:30')).toBe('Accettalo o rifiutalo entro le 12:45 di oggi.');
  });
  it('caso 2 — lunedì 14:00, «Oggi · 19:30–21:00»: entro le 19:15', () => {
    expect(riga(roma(14), 'Oggi · 19:30–21:00')).toBe('Accettalo o rifiutalo entro le 19:15 di oggi.');
  });
  it('caso 3 — lunedì 18:00, «Domani · 13:00–16:30»: entro le 12:45 di domani', () => {
    expect(riga(roma(18), 'Domani · 13:00–16:30')).toBe('Accettalo o rifiutalo entro le 12:45 di domani.');
  });
  it('caso 4 — lunedì 9:30, «Oggi · 9:00–11:00»: entro le 10:00, anche col forno aperto in tutta la fascia', () => {
    expect(riga(roma(9, 30), 'Oggi · 9:00–11:00')).toBe('Accettalo o rifiutalo entro le 10:00 di oggi.');
  });
  it('caso 6 — nato alle 12:46:01 per 13:00–16:30: il ritiro non è più possibile, mai «entro le 16:30»', () => {
    const testo = riga(roma(12, 46, 1), 'Oggi · 13:00–16:30') ?? '';
    expect(testo).not.toMatch(/16:30/);
    expect(testo).toBe('Il ritiro per questa fascia non è più possibile: l’ordine si sta annullando da solo.');
    expect(ancoraNeiTempi(ordine(roma(12, 46, 1), 'Oggi · 13:00–16:30'), roma(12, 46, 2), ORARI_PQ)).toBe(false);
  });
  it('caso 5 — la regola del giro notturno: vivo fino alle 12:45:59, morto dalle 12:46', () => {
    const o = ordine(roma(12), 'Oggi · 13:00–16:30');
    expect(ancoraNeiTempi(o, roma(12, 45, 30), ORARI_PQ)).toBe(true);
    expect(ancoraNeiTempi(o, roma(12, 46), ORARI_PQ)).toBe(false);
  });
});

// ── Il giro notturno vero ────────────────────────────────────────────────────────────────────
const stato: { candidati: Array<Record<string, unknown>>; colonne: string[]; aggiornati: number } = {
  candidati: [],
  colonne: [],
  aggiornati: 0,
};
const notifiche: Array<Record<string, unknown>> = [];

/** Una lettura finta che fa quello che fa il database: filtra `lt` e porta il negozio solo se chiesto. */
function lettura(colonne: string) {
  const conOrari = /seller\s*:\s*profiles!orders_seller_id_fkey\s*\(\s*store_hours\s*\)/.test(colonne);
  let righe = stato.candidati.map(({ orari, ...r }) => (conOrari ? { ...r, seller: { store_hours: orari } } : r));
  const b: Record<string, unknown> = {
    eq: () => b,
    limit: () => b,
    lt: (campo: string, valore: string) => {
      righe = righe.filter((r) => String(r[campo]) < valore);
      return b;
    },
    then: (res: (v: unknown) => unknown) => res({ data: righe, error: null }),
  };
  return b;
}
function scrittura(valore: unknown) {
  const b: Record<string, unknown> = {
    eq: () => b, select: () => b, in: () => b, is: () => b, neq: () => b, limit: () => b,
    maybeSingle: () => Promise.resolve(valore),
    single: () => Promise.resolve(valore),
    then: (res: (v: unknown) => unknown) => res(valore),
  };
  return b;
}

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1', reversedCents: 0 })) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          select: (colonne: string) => {
            stato.colonne.push(colonne);
            return lettura(colonne);
          },
          update: () => {
            stato.aggiornati++;
            return scrittura({ data: [{ id: 'o1' }], error: null });
          },
        };
      }
      if (tabella === 'notifications') {
        return {
          insert: async (riga: Record<string, unknown>) => {
            notifiche.push(riga);
            return { error: null };
          },
        };
      }
      return { select: () => scrittura({ data: [], error: null }) };
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

async function giro(adesso: Date) {
  vi.setSystemTime(adesso);
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return (await res.json()) as { canceled?: number; rinviati?: number };
}

const contanti = (nato: Date, fascia: string | null, orari: unknown) => ({
  id: 'o1', user_id: 'u1', payment_method: 'cod', payment_status: 'PENDING', stripe_payment_intent: null,
  total_price: 20, wallet_applied_cents: 0, coupon_code: null, internal_dispute_status: null,
  created_at: nato.toISOString(), delivery_slot: fascia, orari,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  stato.candidati = [];
  stato.colonne.length = 0;
  stato.aggiornati = 0;
  notifiche.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('il giro notturno fa scadere l’ordine dopo l’ultimo ritiro, non a fine fascia', () => {
  it('caso 5 — nato lunedì 12:00 per 13:00–16:30, mai accettato: alle 12:30 resta, alle 12:50 scade', async () => {
    stato.candidati = [contanti(roma(12), 'Oggi · 13:00–16:30', ORARI_PQ)];
    expect(await giro(roma(12, 30))).toMatchObject({ canceled: 0, rinviati: 1 });
    expect(stato.aggiornati).toBe(0);

    const scaduto = await giro(roma(12, 50));
    expect(scaduto).toMatchObject({ canceled: 1 });
    // La ricerca dei candidati (la prima lettura degli ordini) chiede gli orari del negozio.
    expect(stato.colonne[0]).toMatch(/store_hours/);
  });

  it('caso 5 — il cliente riceve lo stesso avviso di un ordine scaduto per le tre ore', async () => {
    stato.candidati = [contanti(roma(12), 'Oggi · 13:00–16:30', ORARI_PQ)];
    await giro(roma(12, 50));
    const avvisoRitiro = notifiche.splice(0);
    expect(avvisoRitiro).toHaveLength(1);

    stato.candidati = [contanti(roma(9), null, ORARI_PQ)];
    await giro(roma(12, 50));
    expect(notifiche).toHaveLength(1);
    expect(avvisoRitiro[0]).toEqual(notifiche[0]);
  });

  it('caso 6 — nato alle 12:46:01 per 13:00–16:30: il giro dopo lo fa scadere', async () => {
    stato.candidati = [contanti(roma(12, 46, 1), 'Oggi · 13:00–16:30', ORARI_PQ)];
    expect(await giro(roma(13, 0))).toMatchObject({ canceled: 1 });
  });

  it('senza orari del negozio niente cambia: la fascia tiene vivo l’ordine fino alla fine', async () => {
    stato.candidati = [contanti(roma(12), 'Oggi · 13:00–16:30', null)];
    expect(await giro(roma(16))).toMatchObject({ canceled: 0, rinviati: 1 });
  });
});
