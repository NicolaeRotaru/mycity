import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 16/10/2026 — REGISTRARE I CONTANTI DOPO UN RIMBORSO RIMETTEVA L'ORDINE A «PAGATO».
 *
 * L'incasso scriveva sempre `payment_status: 'PAID'`. Lunedi' un ordine in
 * contanti viene consegnato senza incasso dichiarato; mercoledi' il cliente fa
 * un reso parziale e il rimborso scrive PARTIALLY_REFUNDED (l'ordine resta fra
 * quelli da rimettere); giovedi' l'amministratore registra i contanti e lo stato
 * torna «PAID»: il rimborso sparisce dallo stato dell'ordine. Con un rimborso
 * pieno, una chiamata diretta lo riportava a «PAID» e le metriche del negozio
 * tornavano a contarlo come venduto.
 *
 * Qui le due rotte vere scrivono su un database finto che i filtri della UPDATE
 * li GUARDA: una scrittura passa solo se la riga li soddisfa davvero.
 */

type Riga = Record<string, unknown>;

const ID = '55555555-5555-4555-8555-555555555555';

const stato: {
  utente: { id: string };
  ordine: Riga | null;
  /** Cosa succede fra la lettura e la scrittura (un rimborso che arriva in mezzo). */
  primaDellaScrittura: (() => void) | null;
  scritture: Array<{ valori: Riga; filtri: Array<[string, string, unknown]> }>;
} = { utente: { id: 'amministratore-1' }, ordine: null, primaDellaScrittura: null, scritture: [] };

function soddisfa(riga: Riga, filtri: Array<[string, string, unknown]>): boolean {
  return filtri.every(([op, col, val]) => {
    if (op === 'eq') return riga[col] === val;
    if (op === 'is') return val === null ? riga[col] == null : riga[col] === val;
    if (op === 'in') return (val as unknown[]).includes(riga[col]);
    return true;
  });
}

function lettura(risultato: () => unknown) {
  const b: Record<string, unknown> = {};
  for (const op of ['eq', 'is', 'in', 'gte', 'lt', 'lte', 'order', 'limit']) b[op] = () => b;
  b.single = () => Promise.resolve(risultato());
  b.maybeSingle = () => Promise.resolve(risultato());
  b.then = (r: (v: unknown) => unknown) => Promise.resolve(risultato()).then(r);
  return b;
}

function aggiornamento(valori: Riga) {
  const filtri: Array<[string, string, unknown]> = [];
  const b: Record<string, unknown> = {};
  for (const op of ['eq', 'is', 'in']) {
    b[op] = (col: string, val: unknown) => { filtri.push([op, col, val]); return b; };
  }
  b.select = () => b;
  b.then = (r: (v: unknown) => unknown) => {
    stato.primaDellaScrittura?.();
    stato.scritture.push({ valori, filtri });
    const tocca = stato.ordine && soddisfa(stato.ordine, filtri);
    if (tocca) Object.assign(stato.ordine as Riga, valori);
    return Promise.resolve({ data: tocca ? [{ id: ID }] : [], error: null }).then(r);
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ from: () => ({ select: () => lettura(() => ({ data: null, error: null })) }) }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          select: (colonne: string) =>
            colonne.includes('cash_confirmed_at')
              // Come PostgREST: tornano solo le colonne chieste.
              ? lettura(() => {
                if (!stato.ordine) return { data: null, error: null };
                const chieste = colonne.split(',').map((c) => c.trim());
                return { data: Object.fromEntries(chieste.map((c) => [c, (stato.ordine as Riga)[c] ?? null])), error: null };
              })
              : lettura(() => ({ data: [], error: null })),
          update: (valori: Riga) => aggiornamento(valori),
        };
      }
      if (tabella === 'cod_reconciliations') return { upsert: () => Promise.resolve({ error: null }) };
      if (tabella === 'profiles') return { select: () => lettura(() => ({ data: [], error: null })) };
      return { insert: () => Promise.resolve({ error: null }) };
    },
  }),
}));

vi.mock('@/lib/api/middleware', () => {
  const passa = (h: (ctx: { user: { id: string }; req: unknown }) => unknown) =>
    (req: unknown) => h({ user: stato.utente, req });
  return {
    withAuthRateLimit: (_o: unknown, h: (ctx: { user: { id: string }; req: unknown }) => unknown) => passa(h),
    withAdminAuthRateLimit: (_o: unknown, h: (ctx: { user: { id: string }; req: unknown }) => unknown) => passa(h),
  };
});
vi.mock('@/lib/audit', () => ({ writeAudit: async () => {} }));
vi.mock('@/lib/activity', () => ({ recordActivity: async () => {} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

/** Ordine da 25 euro in contanti, consegnato, contanti non dichiarati. */
function consegnato(sopra: Riga = {}): Riga {
  return {
    id: ID,
    rider_id: 'fattorino-1',
    total_price: 25,
    rider_fee_cents: 300,
    shipping_cost: 0,
    pickup_in_store: false,
    payment_method: 'cod',
    payment_status: 'PENDING',
    delivery_status: 'DELIVERED',
    cash_confirmed_at: null,
    delivered_at: '2026-10-12T18:00:00Z',
    refunded_amount_cents: 0,
    ...sopra,
  };
}

function richiesta(corpo: Riga) {
  return new Request('http://localhost/prova', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

async function registraDaAmministratore() {
  stato.utente = { id: 'amministratore-1' };
  const { POST } = await import('@/app/api/admin/cod-incasso-dichiarato/route');
  return (POST as unknown as (r: Request) => Promise<Response>)(
    richiesta({ orderId: ID, cashCollectedCents: 2200, nota: 'Luca al telefono, 15/10 ore 18' }),
  );
}

async function confermaDalFattorino() {
  stato.utente = { id: 'fattorino-1' };
  const { POST } = await import('@/app/api/rider/cash-confirm/route');
  return (POST as unknown as (r: Request) => Promise<Response>)(richiesta({ orderId: ID, cashCollectedCents: 2200 }));
}

beforeEach(() => {
  stato.ordine = consegnato();
  stato.primaDellaScrittura = null;
  stato.scritture = [];
});

describe('un ordine ancora da pagare diventa pagato quando arrivano i contanti', () => {
  it('l amministratore registra: PENDING diventa PAID', async () => {
    const res = await registraDaAmministratore();
    expect(res.status).toBe(200);
    expect(stato.ordine?.payment_status).toBe('PAID');
    expect(stato.ordine?.cash_confirmed_at).toBeTruthy();
  });

  it('il fattorino conferma: PENDING diventa PAID', async () => {
    const res = await confermaDalFattorino();
    expect(res.status).toBe(200);
    expect(stato.ordine?.payment_status).toBe('PAID');
  });
});

describe('un rimborso gia registrato resta scritto', () => {
  it('reso parziale prima dell incasso: lo stato resta PARTIALLY_REFUNDED, l incasso si registra', async () => {
    stato.ordine = consegnato({ payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 1000 });
    const res = await registraDaAmministratore();
    expect(res.status, 'l incasso di un ordine col reso parziale non si registra piu: il negozio non viene pagato').toBe(200);
    expect(
      stato.ordine?.payment_status,
      'registrare i contanti ha riscritto «pagato» sopra il rimborso parziale',
    ).toBe('PARTIALLY_REFUNDED');
    expect(stato.ordine?.cash_confirmed_at).toBeTruthy();
    expect(stato.ordine?.refunded_amount_cents).toBe(1000);
  });

  it('rimborso pieno raggiunto con una chiamata diretta: resta REFUNDED', async () => {
    stato.ordine = consegnato({ payment_status: 'REFUNDED', refunded_amount_cents: 2500 });
    await registraDaAmministratore();
    expect(
      stato.ordine?.payment_status,
      'un ordine rimborsato per intero torna «pagato» e le metriche del negozio lo contano di nuovo come venduto',
    ).toBe('REFUNDED');
  });

  it('vale anche quando conferma il fattorino', async () => {
    stato.ordine = consegnato({ payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 1000 });
    const res = await confermaDalFattorino();
    expect(res.status).toBe(200);
    expect(stato.ordine?.payment_status).toBe('PARTIALLY_REFUNDED');
  });

  it('un rimborso che arriva fra la lettura e la scrittura non viene coperto da «PAID»', async () => {
    // L'ordine si legge PENDING; un attimo prima della UPDATE il rimborso scrive PARTIALLY_REFUNDED.
    stato.primaDellaScrittura = () => {
      Object.assign(stato.ordine as Riga, { payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 1000 });
    };
    const res = await registraDaAmministratore();
    expect(
      stato.ordine?.payment_status,
      'la scrittura dell incasso ha coperto un rimborso arrivato un attimo prima',
    ).toBe('PARTIALLY_REFUNDED');
    // Nessuna scrittura a meta': chi riprova rilegge l'ordine com'e' adesso.
    expect(res.status).toBe(409);
    expect(stato.ordine?.cash_confirmed_at).toBeNull();
  });
});
