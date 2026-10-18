import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 15/10/2026 (R70) — IL BONIFICO AL NEGOZIO: SOLO A ORDINE CONSEGNATO, E UNA
 * VOLTA SOLA. DUE CONTROLLI CHE NESSUNA PROVA TENEVA.
 *
 * La radiografia dell'11/10 li ha tolti in una copia del codice e la suite e'
 * rimasta verde:
 *
 *  ③ il negozio riceve il bonifico solo quando l'ordine e' consegnato. Senza,
 *    un ordine ancora in strada — o mai partito — viene pagato al negozio;
 *  ④ il turno del bonifico si prende in modo atomico: la UPDATE passa l'ordine
 *    a PROCESSING solo se e' ancora HELD (o in attesa dell'account Stripe).
 *    Senza quel filtro, due giri che si sovrappongono — il giro automatico e il
 *    pulsante dell'amministratore — leggono tutti e due HELD e pagano due volte.
 *
 * Le prove che c'erano usavano un database finto che ACCETTAVA QUALUNQUE
 * FILTRO e rispondeva sempre «una riga aggiornata»: togliere il filtro non
 * cambiava niente, perche' il finto non lo guardava. Questo finto i filtri li
 * applica, come il database vero: una UPDATE tocca la riga solo se la riga li
 * soddisfa tutti.
 */

type Riga = Record<string, unknown>;

/** La riga dell'ordine nel «database». */
let ordine: Riga = {};
/** Cosa fa l'altro giro mentre questo legge il profilo del negozio. */
let duranteLaLetturaDelNegozio: (() => void) | null = null;

const bonifici = vi.fn(async (_corpo: Riga, _opzioni: { idempotencyKey: string }) => ({ id: `tr_${bonifici.mock.calls.length}` }));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ transfers: { create: bonifici, list: async () => ({ data: [] }) } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

type Filtro = [op: 'eq' | 'in' | 'is', colonna: string, valore: unknown];

function soddisfa(riga: Riga, filtri: Filtro[]): boolean {
  return filtri.every(([op, col, val]) => {
    if (op === 'eq') return riga[col] === val;
    if (op === 'in') return (val as unknown[]).includes(riga[col]);
    return val === null ? riga[col] == null : riga[col] === val;
  });
}

/** Una lettura: restituisce una FOTOGRAFIA della riga, come il database vero. */
function lettura(fornisci: () => Riga | null) {
  const b: Record<string, unknown> = {};
  b.eq = () => b;
  b.single = () => Promise.resolve({ data: fornisci(), error: null });
  b.maybeSingle = b.single;
  return b;
}

/** Una scrittura: tocca la riga solo se soddisfa TUTTI i filtri. */
function scrittura(valori: Riga) {
  const filtri: Filtro[] = [];
  const b: Record<string, unknown> = {};
  b.eq = (c: string, v: unknown) => { filtri.push(['eq', c, v]); return b; };
  b.in = (c: string, v: unknown) => { filtri.push(['in', c, v]); return b; };
  b.is = (c: string, v: unknown) => { filtri.push(['is', c, v]); return b; };
  b.select = () => b;
  b.then = (r: (v: unknown) => unknown) => {
    const tocca = soddisfa(ordine, filtri);
    if (tocca) Object.assign(ordine, valori);
    return Promise.resolve({ data: tocca ? [{ id: ordine.id }] : [], error: null }).then(r);
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          select: () => lettura(() => ({ ...ordine })),
          update: (valori: Riga) => scrittura(valori),
        };
      }
      if (tabella === 'profiles') {
        return {
          select: () => lettura(() => {
            const altro = duranteLaLetturaDelNegozio;
            duranteLaLetturaDelNegozio = null;
            altro?.();
            return { stripe_account_id: 'acct_negozio', stripe_payouts_enabled: true };
          }),
        };
      }
      return {};
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

import { releaseOrderPayout } from '@/lib/stripe/payout';

function ordineDaPagare(sopra: Riga = {}): Riga {
  return {
    id: 'o1',
    seller_id: 'negozio-1',
    payout_status: 'HELD',
    delivery_status: 'DELIVERED',
    seller_payout_cents: 2250,
    seller_payout_reversed_cents: 0,
    payout_tentativo: 0,
    stripe_charge_id: 'ch_1',
    stripe_transfer_group: 'mc_pc_1',
    ...sopra,
  };
}

beforeEach(() => {
  bonifici.mockClear();
  duranteLaLetturaDelNegozio = null;
  ordine = ordineDaPagare();
});

describe('il bonifico al negozio', () => {
  it('la strada di controllo: un ordine consegnato e HELD viene pagato, una volta', async () => {
    const esito = await releaseOrderPayout('o1');
    expect(esito).toEqual({ ok: true, transferId: 'tr_1' });
    expect(bonifici).toHaveBeenCalledTimes(1);
    expect(ordine.payout_status).toBe('TRANSFERRED');
  });

  it('③ un ordine non ancora consegnato NON viene pagato al negozio', async () => {
    for (const stato of ['OUT_FOR_DELIVERY', 'PICKED_UP', 'READY', 'NEW']) {
      ordine = ordineDaPagare({ delivery_status: stato });
      const esito = await releaseOrderPayout('o1');
      expect(esito.ok, `ordine ${stato}: il negozio viene pagato prima della consegna`).toBe(false);
      expect((esito as { code?: string }).code).toBe('NOT_DELIVERED');
      expect(ordine.payout_status, `ordine ${stato}: il turno del bonifico e stato preso lo stesso`).toBe('HELD');
    }
    expect(bonifici, 'e partito un bonifico per un ordine non consegnato').not.toHaveBeenCalled();
  });

  it('④ se un altro giro ha preso il turno nel frattempo, questo non paga', async () => {
    // Questo giro legge l'ordine: HELD. Mentre legge il profilo del negozio,
    // il giro automatico lo prende in carico (PROCESSING).
    duranteLaLetturaDelNegozio = () => { ordine.payout_status = 'PROCESSING'; };

    const esito = await releaseOrderPayout('o1');

    expect(esito.ok).toBe(false);
    expect((esito as { code?: string }).code).toBe('BAD_STATE');
    expect(bonifici, 'il turno non e atomico: due giri pagano due volte lo stesso negozio').not.toHaveBeenCalled();
    expect(ordine.payout_status, 'questo giro ha sovrascritto il turno dell altro').toBe('PROCESSING');
  });

  it('④ due giri lanciati insieme sullo stesso ordine fanno UN bonifico', async () => {
    const esiti = await Promise.all([releaseOrderPayout('o1'), releaseOrderPayout('o1')]);
    expect(bonifici, 'due bonifici per lo stesso ordine').toHaveBeenCalledTimes(1);
    expect(esiti.filter((e) => e.ok)).toHaveLength(1);
    expect(esiti.filter((e) => !e.ok && (e as { code?: string }).code === 'BAD_STATE')).toHaveLength(1);
  });
});
