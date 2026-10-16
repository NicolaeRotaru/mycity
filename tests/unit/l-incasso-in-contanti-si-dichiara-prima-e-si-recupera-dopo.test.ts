import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 15/10/2026 (R33) — SE IL FATTORINO CHIUDEVA LA CONSEGNA PRIMA DEI CONTANTI,
 * IL NEGOZIO NON VENIVA PAGATO. E DOPO SETTE GIORNI NON SI POTEVA PIU'
 * RIMEDIARE.
 *
 * Martedi' sera, ordine da 25 euro in contanti da Pane Quotidiano. Il
 * fattorino detta il codice, la pagina torna alla bacheca, i contanti restano
 * non dichiarati. La rimessa della sera salta l'ordine. Da li':
 *  · la bacheca non glielo ricordava (mostrava solo le consegne in corso);
 *  · la rotta dell'incasso leggeva l'ordine con la sua sessione, e la regola
 *    sugli ordini gli nasconde i consegnati da piu' di sette giorni: «Ordine
 *    non trovato», per sempre;
 *  · l'amministratore leggeva «vanno chiesti al fattorino» e non aveva un
 *    pulsante per registrarlo lui.
 *
 * Qui si eseguono le regole pure, le due rotte del fattorino e quella
 * dell'amministratore, con un database finto che i filtri li GUARDA: una
 * scrittura passa solo se la riga soddisfa davvero le condizioni della UPDATE.
 */

type Riga = Record<string, unknown>;

const stato: {
  utente: { id: string };
  ordine: Riga | null;
  scritture: Array<{ valori: Riga; filtri: Array<[string, string, unknown]> }>;
  quadrature: Riga[];
  registro: Riga[];
  filtriLettura: Array<[string, string, unknown]>;
  righeIncassi: Riga[];
  sessioneVede: boolean;
} = {
  utente: { id: 'fattorino-1' },
  ordine: null,
  scritture: [],
  quadrature: [],
  registro: [],
  filtriLettura: [],
  righeIncassi: [],
  sessioneVede: false,
};

/** Una riga soddisfa i filtri di una UPDATE? Come farebbe il database. */
function soddisfa(riga: Riga, filtri: Array<[string, string, unknown]>): boolean {
  return filtri.every(([op, col, val]) => {
    if (op === 'eq') return riga[col] === val;
    if (op === 'is') return val === null ? riga[col] == null : riga[col] === val;
    if (op === 'in') return (val as unknown[]).includes(riga[col]);
    return true;
  });
}

function lettura(risultato: () => unknown, filtri: Array<[string, string, unknown]> = []) {
  const b: Record<string, unknown> = {};
  for (const op of ['eq', 'is', 'in', 'gte', 'lt', 'lte']) {
    b[op] = (col: string, val: unknown) => { filtri.push([op, col, val]); return b; };
  }
  b.order = () => b;
  b.limit = () => b;
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
    stato.scritture.push({ valori, filtri });
    const tocca = stato.ordine && soddisfa(stato.ordine, filtri);
    if (tocca) Object.assign(stato.ordine as Riga, valori);
    return Promise.resolve({ data: tocca ? [{ id: (stato.ordine as Riga).id }] : [], error: null }).then(r);
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  // La sessione del fattorino: la regola sugli ordini gli nasconde i
  // consegnati da piu' di sette giorni. Qui di default non vede niente.
  getServerSupabase: async () => ({
    from: () => ({
      select: () => lettura(() => (stato.sessioneVede
        ? { data: stato.ordine, error: null }
        : { data: null, error: { message: 'nessuna riga' } })),
    }),
  }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          select: (colonne: string) => {
            if (colonne.includes('seller:profiles')) {
              return lettura(() => ({ data: stato.righeIncassi, error: null }), stato.filtriLettura);
            }
            if (colonne.includes('cash_confirmed_at')) {
              return lettura(() => ({ data: stato.ordine ? { ...stato.ordine } : null, error: null }));
            }
            // La quadratura della giornata.
            return lettura(() => ({ data: [], error: null }));
          },
          update: (valori: Riga) => aggiornamento(valori),
        };
      }
      if (tabella === 'cod_reconciliations') {
        return { upsert: (riga: Riga) => { stato.quadrature.push(riga); return Promise.resolve({ error: null }); } };
      }
      if (tabella === 'profiles') return { select: () => lettura(() => ({ data: [], error: null })) };
      return { insert: () => Promise.resolve({ error: null }) };
    },
  }),
}));

vi.mock('@/lib/api/middleware', () => {
  const passa = (h: (ctx: { user: { id: string }; req: unknown }) => unknown) =>
    (req: unknown) => h({ user: stato.utente, req });
  return {
    withAuth: passa,
    withAuthRateLimit: (_o: unknown, h: (ctx: { user: { id: string }; req: unknown }) => unknown) => passa(h),
    withAdminAuthRateLimit: (_o: unknown, h: (ctx: { user: { id: string }; req: unknown }) => unknown) => passa(h),
  };
});

vi.mock('@/lib/audit', () => ({
  writeAudit: async (voce: Riga) => { stato.registro.push(voce); },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import {
  dopoIlCodiceGiusto,
  incassiRimastiIndietro,
  incassoDaDichiarare,
  passoDellaConsegna,
} from '@/lib/rider/incasso-alla-consegna';
import { motivoPerNonRegistrare, statiAmmessi, type OrdineDaIncassare } from '@/lib/cassa/registra-incasso';

const ID = '33333333-3333-4333-8333-333333333333';

function richiesta(corpo: Riga) {
  return new Request('http://localhost/prova', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

/** Ordine da 25 euro in contanti, consegnato il 6 ottobre alle 21:30 di Piacenza, senza incasso. */
function consegnatoSenzaIncasso(sopra: Riga = {}): Riga {
  return {
    id: ID,
    rider_id: 'fattorino-1',
    total_price: 25,
    rider_fee_cents: 300,
    shipping_cost: 0,
    pickup_in_store: false,
    payment_method: 'cod',
    delivery_status: 'DELIVERED',
    cash_confirmed_at: null,
    delivered_at: '2026-10-06T19:30:00Z',
    ...sopra,
  };
}

beforeEach(() => {
  stato.utente = { id: 'fattorino-1' };
  stato.ordine = consegnatoSenzaIncasso();
  stato.scritture = [];
  stato.quadrature = [];
  stato.registro = [];
  stato.filtriLettura = [];
  stato.righeIncassi = [];
  stato.sessioneVede = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  // Nove giorni dopo la consegna: la sessione del fattorino non la vede piu'.
  vi.setSystemTime(new Date('2026-10-15T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('le regole: prima i contanti, poi il codice', () => {
  const inStrada = { payment_method: 'cod', delivery_status: 'OUT_FOR_DELIVERY', cash_confirmed_at: null };

  it('in contanti senza incasso il passo della consegna sono i contanti', () => {
    expect(passoDellaConsegna(inStrada)).toBe('incasso');
    expect(passoDellaConsegna({ ...inStrada, delivery_status: 'PICKED_UP' })).toBe('incasso');
  });

  it('con l incasso dichiarato, o con la carta, si chiude col codice', () => {
    expect(passoDellaConsegna({ ...inStrada, cash_confirmed_at: '2026-10-14T18:00:00Z' })).toBe('codice');
    expect(passoDellaConsegna({ ...inStrada, payment_method: 'card' })).toBe('codice');
  });

  it('dopo il codice giusto si resta sull ordine se i contanti mancano ancora', () => {
    expect(dopoIlCodiceGiusto(inStrada), 'si tornava alla bacheca e i contanti sparivano dalla vista').toBe('resta-sull-ordine');
    expect(dopoIlCodiceGiusto({ ...inStrada, cash_confirmed_at: '2026-10-14T18:00:00Z' })).toBe('bacheca');
    expect(dopoIlCodiceGiusto({ ...inStrada, payment_method: 'card' })).toBe('bacheca');
  });

  it('un ordine appena assegnato non chiede ancora contanti, un ritiro in negozio mai', () => {
    expect(incassoDaDichiarare({ ...inStrada, delivery_status: 'ASSIGNED' })).toBe(false);
    expect(incassoDaDichiarare({ ...inStrada, pickup_in_store: true })).toBe(false);
  });

  it('la bacheca rimette davanti i consegnati senza incasso, dal piu vecchio', () => {
    const righe = [
      { id: 'b', payment_method: 'cod', delivery_status: 'DELIVERED', cash_confirmed_at: null, delivered_at: '2026-10-10T10:00:00Z' },
      { id: 'x', payment_method: 'cod', delivery_status: 'DELIVERED', cash_confirmed_at: '2026-10-09T10:00:00Z', delivered_at: '2026-10-09T09:00:00Z' },
      { id: 'a', payment_method: 'cod', delivery_status: 'DELIVERED', cash_confirmed_at: null, delivered_at: '2026-10-06T19:30:00Z' },
      { id: 'c', payment_method: 'card', delivery_status: 'DELIVERED', cash_confirmed_at: null, delivered_at: '2026-10-05T10:00:00Z' },
      { id: 'd', payment_method: 'cod', delivery_status: 'OUT_FOR_DELIVERY', cash_confirmed_at: null, delivered_at: null },
    ];
    expect(incassiRimastiIndietro(righe).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('chi puo registrare quale incasso', () => {
  const base = consegnatoSenzaIncasso() as unknown as OrdineDaIncassare;
  const fattorino = { chi: 'fattorino', userId: 'fattorino-1' } as const;
  const amministratore = { chi: 'amministratore', userId: 'amministratore-1' } as const;

  it('il fattorino: i suoi ordini, dalla merce in mano fino a dopo la consegna', () => {
    expect(motivoPerNonRegistrare(base, fattorino)).toBeNull();
    expect(motivoPerNonRegistrare({ ...base, delivery_status: 'OUT_FOR_DELIVERY' }, fattorino)).toBeNull();
    expect(motivoPerNonRegistrare(base, { chi: 'fattorino', userId: 'fattorino-2' })).toBe('DI_UN_ALTRO_FATTORINO');
    expect(statiAmmessi(fattorino)).toEqual(['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']);
  });

  it('l amministratore: solo a consegna chiusa, perche in strada i contanti li ha il fattorino', () => {
    expect(motivoPerNonRegistrare(base, amministratore)).toBeNull();
    expect(motivoPerNonRegistrare({ ...base, delivery_status: 'OUT_FOR_DELIVERY' }, amministratore)).toBe('NON_ANCORA_CONSEGNATO');
    expect(motivoPerNonRegistrare({ ...base, rider_id: null }, amministratore)).toBe('SENZA_FATTORINO');
    expect(statiAmmessi(amministratore)).toEqual(['DELIVERED']);
  });

  it('per nessuno: un ordine con la carta, o gia incassato', () => {
    expect(motivoPerNonRegistrare({ ...base, payment_method: 'card' }, amministratore)).toBe('NON_IN_CONTANTI');
    expect(motivoPerNonRegistrare({ ...base, cash_confirmed_at: '2026-10-06T19:31:00Z' }, fattorino)).toBe('GIA_CONFERMATO');
    expect(motivoPerNonRegistrare(null, fattorino)).toBe('NON_TROVATO');
  });
});

describe('il fattorino rimedia anche dopo sette giorni', () => {
  async function confermaIncasso(corpo: Riga) {
    const { POST } = await import('@/app/api/rider/cash-confirm/route');
    return (POST as unknown as (r: Request) => Promise<Response>)(richiesta(corpo));
  }

  it('nove giorni dopo la consegna l incasso si conferma, invece di «ordine non trovato»', async () => {
    const res = await confermaIncasso({ orderId: ID, cashCollectedCents: 2200 });
    expect(
      res.status,
      'il fattorino non puo piu dichiarare i contanti: la rimessa salta l ordine per sempre e il negozio non viene pagato',
    ).toBe(200);
    expect(stato.ordine?.cash_confirmed_at, 'l incasso non e stato scritto').toBeTruthy();
    expect(stato.ordine?.cash_collected_by).toBe('fattorino-1');
  });

  it('la quadratura aggiornata e quella della sera della consegna, non quella di oggi', async () => {
    await confermaIncasso({ orderId: ID, cashCollectedCents: 2200 });
    expect(
      stato.quadrature[0]?.for_date,
      'la giornata della consegna resta indietro: la rimessa di quel giorno non quadra',
    ).toBe('2026-10-06');
  });

  it('un altro fattorino non puo dichiararlo al suo posto', async () => {
    stato.utente = { id: 'fattorino-2' };
    const res = await confermaIncasso({ orderId: ID, cashCollectedCents: 2200 });
    expect(res.status).toBe(403);
    expect(stato.ordine?.cash_confirmed_at).toBeNull();
  });
});

describe('la bacheca chiede al server le consegne senza incasso', () => {
  it('legge solo quelle del fattorino collegato, senza recapiti del cliente', async () => {
    stato.righeIncassi = [{
      id: ID, delivered_at: '2026-10-06T19:30:00Z', total_price: 25, rider_fee_cents: 300, shipping_cost: 0,
      pickup_in_store: false, payment_method: 'cod', delivery_status: 'DELIVERED', cash_confirmed_at: null,
      seller: { store_name: 'Pane Quotidiano' },
      // Anche se il database li restituisse, alla bacheca non devono arrivare.
      delivery_phone: '3331234567', delivery_address: 'Via Verdi 10',
    }];
    const { GET } = await import('@/app/api/rider/incassi-da-dichiarare/route');
    const res = await (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/prova'));
    expect(res.status).toBe(200);
    const corpo = await res.json();

    expect(stato.filtriLettura).toContainEqual(['eq', 'rider_id', 'fattorino-1']);
    expect(stato.filtriLettura).toContainEqual(['is', 'cash_confirmed_at', null]);
    expect(corpo.incassi).toEqual([{
      id: ID, deliveredAt: '2026-10-06T19:30:00Z', storeName: 'Pane Quotidiano',
      expectedCents: 2200, compensoTenutoCents: 300, residuoDovutoCents: 0,
    }]);
    expect(JSON.stringify(corpo)).not.toMatch(/Via Verdi|3331234567/);
  });
});

describe('l amministratore registra l incasso dichiarato', () => {
  async function registra(corpo: Riga) {
    const { POST } = await import('@/app/api/admin/cod-incasso-dichiarato/route');
    return (POST as unknown as (r: Request) => Promise<Response>)(richiesta(corpo));
  }

  beforeEach(() => {
    stato.utente = { id: 'amministratore-1' };
  });

  it('su una consegna chiusa senza incasso lo registra, con nome e motivo nel registro', async () => {
    const res = await registra({ orderId: ID, cashCollectedCents: 2200, nota: 'Luca al telefono, 14/10 ore 18' });
    expect(res.status, 'l amministratore non ha una strada: resta solo il database a mano').toBe(200);

    expect(stato.ordine?.cash_confirmed_at).toBeTruthy();
    expect(stato.ordine?.cash_collected_cents).toBe(2200);
    expect(stato.ordine?.cash_collected_by, 'deve restare chiaro che non l ha confermato il fattorino').toBe('amministratore-1');
    expect(stato.registro).toHaveLength(1);
    expect(stato.registro[0]).toMatchObject({
      actorId: 'amministratore-1',
      action: 'order.cash_declared',
      targetId: ID,
      metadata: { fattorino: 'fattorino-1', incassato_cents: 2200, nota: 'Luca al telefono, 14/10 ore 18' },
    });
    expect(stato.quadrature[0]?.for_date).toBe('2026-10-06');
  });

  it('mentre la consegna e in strada no: i contanti li ha in mano il fattorino', async () => {
    stato.ordine = consegnatoSenzaIncasso({ delivery_status: 'OUT_FOR_DELIVERY', delivered_at: null });
    const res = await registra({ orderId: ID, cashCollectedCents: 2200, nota: 'Luca al telefono' });
    expect(res.status).toBe(409);
    expect(stato.ordine?.cash_confirmed_at).toBeNull();
    expect(stato.registro).toHaveLength(0);
  });

  it('senza una nota su chi li ha dichiarati non registra niente', async () => {
    const res = await registra({ orderId: ID, cashCollectedCents: 2200, nota: '' });
    expect(res.status).toBe(400);
    expect(stato.ordine?.cash_confirmed_at).toBeNull();
  });

  it('un incasso gia confermato non si riscrive', async () => {
    stato.ordine = consegnatoSenzaIncasso({ cash_confirmed_at: '2026-10-06T19:31:00Z', cash_collected_cents: 2200 });
    const res = await registra({ orderId: ID, cashCollectedCents: 100, nota: 'Luca al telefono' });
    expect(res.status).toBe(409);
    expect(stato.ordine?.cash_collected_cents).toBe(2200);
  });

  it('la scrittura stessa, nel database, accetta solo un ordine consegnato', async () => {
    await registra({ orderId: ID, cashCollectedCents: 2200, nota: 'Luca al telefono' });
    const filtri = stato.scritture[0]?.filtri ?? [];
    expect(filtri).toContainEqual(['in', 'delivery_status', ['DELIVERED']]);
    expect(filtri).toContainEqual(['is', 'cash_confirmed_at', null]);
    expect(filtri).toContainEqual(['eq', 'rider_id', 'fattorino-1']);
  });
});
