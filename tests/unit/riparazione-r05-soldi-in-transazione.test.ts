import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R05-006 — I SOLDI FRA GLI ORDINI DEL CARRELLO PASSANO IN UNA TRANSAZIONE.
 *
 * Pane 15 € + frutta 12 €, pagati con la carta: pane 3 € di consegna e 3 € al fattorino (18 €),
 * frutta 1 € e 1 € (13 €). Il forno rifiuta: la sua consegna scende a 1 € e il fattorino a 0 (16 €),
 * la frutta sale a 3 € e 3 € (15 €), e al cliente tornano 16 €.
 *
 * Prima queste scritture erano una per riga, con una compensazione scritta a mano. Se il database
 * smetteva di scrivere a metà (e la compensazione cadeva con lui), o il processo si fermava fra due
 * scritture, il carrello restava a metà: il pane a 1 € di consegna, la frutta ancora a 1 €. Due euro
 * spariti dal carrello, e la carta rendeva 18 € su un ordine che ne diceva 16.
 *
 * Qui il guasto arriva sempre nello stesso punto — la scrittura che tocca la frutta — e la regola è
 * una sola: dopo l'annullo il carrello è TUTTO com'era o TUTTO col conto nuovo, mai a metà. La
 * funzione del database (migrations/620) è finta in ./riparazione-r05-giro-in-transazione.ts e vera
 * in tests/sql/rls/riparazione-r05-soldi-in-transazione.test.sql.
 */

const refundOrder = vi.fn(async (_a: { orderId: string; amountCents: number }) => ({ refundId: 're_1' }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { finto, carrello } from './carrello-finto';
import { conLaFunzioneDelGiro, spostaLaConsegnaNelCarrello, FUNZIONE_DEL_GIRO } from './riparazione-r05-giro-in-transazione';

type Riga = Record<string, unknown>;
type Guasto = {
  /** La scrittura su questo ordine non passa (il database smette di scrivere). */
  cade?: (id: string) => boolean;
  /** Il processo si ferma mentre sta per scrivere questo ordine: non va più avanti. */
  siFerma?: (id: string) => boolean;
};

/**
 * Il carrello in un database finto con un guasto. Lo stesso guasto vale per le scritture una per
 * riga (`from('orders').update`) e per quella insieme (la funzione della 620): lì una scrittura che
 * cade a metà disfa la transazione intera, come in PostgreSQL.
 */
function databaseConUnGuasto(guasto: Guasto, o: { applicata?: boolean } = {}) {
  const db = conLaFunzioneDelGiro(finto({ orders: carrello(['pane', 'frutta'], [1500, 1200], 'card') }), o);
  const caduta = { data: null, error: { code: '57P01', message: 'il database non scrive più' } };
  const vero = db.from;
  db.from = ((t: string) => {
    const q = vero(t) as Record<string, (...a: never[]) => unknown> & {
      then: (ok: (x: unknown) => unknown, ko: (e: unknown) => unknown) => unknown;
    };
    if (t !== 'orders') return q;
    let scrive = false;
    let id = '';
    const { update, eq, then } = q;
    q.update = ((v: Riga) => ((scrive = true), update(v as never))) as never;
    q.eq = ((c: string, v: unknown) => (c === 'id' && (id = String(v)), eq(c as never, v as never))) as never;
    q.then = (ok, ko) => {
      if (scrive && guasto.siFerma?.(id)) return new Promise(() => undefined);
      if (scrive && guasto.cade?.(id)) return Promise.resolve(caduta).then(ok, ko);
      return then(ok, ko);
    };
    return q;
  }) as never;
  const rpc = db.rpc as unknown as (nome: string, args?: Record<string, unknown>) => Promise<unknown>;
  db.rpc = (async (nome: string, args?: Record<string, unknown>) => {
    if (nome !== FUNZIONE_DEL_GIRO || o.applicata === false) return rpc(nome, args);
    const scritte = ((args?.p_righe ?? []) as Array<{ id: string; a?: unknown }>).filter((r) => r.a).map((r) => r.id);
    if (scritte.some((x) => guasto.siFerma?.(x))) return new Promise(() => undefined);
    return spostaLaConsegnaNelCarrello(db.tabelle.orders, args?.p_righe, (r) => {
      if (guasto.cade?.(String(r.id))) throw new Error('il database non scrive più');
    });
  }) as never;
  return db;
}

/** Consegna, fattorino e totale (in centesimi) di pane e frutta, come stanno scritti. */
const PRIMA = [[300, 300, 1800], [100, 100, 1300]];
const DOPO = [[100, 0, 1600], [300, 300, 1500]];
let db: ReturnType<typeof databaseConUnGuasto>;
const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id) as Riga;
const comEScritto = () =>
  ['pane', 'frutta'].map((id) => [riga(id).delivery_fee_cents, riga(id).rider_fee_cents, Math.round(Number(riga(id).total_price) * 100)]);
const rifiutaIlForno = () => annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });

beforeEach(() => {
  refundOrder.mockReset();
  refundOrder.mockImplementation(async () => ({ refundId: 're_1' }));
  vi.mocked(notifyAdmins).mockClear();
});

describe('R05-006 · il conto del carrello passa tutto insieme o niente', () => {
  it('il database smette di scrivere alla frutta (e la compensazione cade con lui): il carrello resta com era e torna quello che l ordine dice', async () => {
    let giu = false;
    db = databaseConUnGuasto({ cade: (id) => (giu ||= id === 'frutta') });
    await rifiutaIlForno();
    // Mai a metà: prima il pane restava a 1 € di consegna e la frutta a 1 € (2 € spariti).
    expect([PRIMA, DOPO]).toContainEqual(comEScritto());
    // E la carta rende quello che l'ordine del pane dice, non 18 € su un ordine da 16.
    const reso = refundOrder.mock.calls[0][0].amountCents;
    expect(reso).toBe(Math.round(Number(riga('pane').total_price) * 100));
    expect(reso + Math.round(Number(riga('frutta').total_price) * 100)).toBe(3100);
  });

  it('il rimborso non parte e il database smette di scrivere mentre rimette il carrello: resta tutto col conto nuovo, e gli amministratori lo sanno', async () => {
    let armato = false;
    let giu = false;
    db = databaseConUnGuasto({ cade: (id) => armato && (giu ||= id === 'frutta') });
    refundOrder.mockImplementationOnce(async () => {
      armato = true;
      throw new Error('Stripe non risponde');
    });
    const esito = await rifiutaIlForno();
    expect(esito.ok).toBe(false);
    // Prima il pane tornava a 3 € di consegna col fattorino a 0, e la frutta restava a 3 €: 2 € in più.
    expect([PRIMA, DOPO]).toContainEqual(comEScritto());
    expect(vi.mocked(notifyAdmins).mock.calls.some((c) => /Carrello da sistemare a mano/.test(String(c[0])))).toBe(true);
  });

  it('il processo si ferma mentre sta per scrivere la frutta: niente resta scritto a metà', async () => {
    db = databaseConUnGuasto({ siFerma: (id) => id === 'frutta' });
    void rifiutaIlForno();
    await new Promise((r) => setTimeout(r, 50));
    expect([PRIMA, DOPO]).toContainEqual(comEScritto());
  });

  it('senza guasti il conto nuovo si scrive tutto: tornano 16 €, la frutta a 3 € e 3 € (15 €)', async () => {
    db = databaseConUnGuasto({});
    await rifiutaIlForno();
    expect(comEScritto()).toEqual(DOPO);
    expect(refundOrder.mock.calls[0][0].amountCents).toBe(1600);
  });

  it('prima che la 620 sia applicata (PGRST202) il conto si scrive ancora, una riga alla volta come prima', async () => {
    db = databaseConUnGuasto({}, { applicata: false });
    await rifiutaIlForno();
    expect(comEScritto()).toEqual(DOPO);
    expect(refundOrder.mock.calls[0][0].amountCents).toBe(1600);
  });
});
