/**
 * R05-004 (onda 2) — IL BONIFICO DI RIMBORSO AL CLIENTE: DOVE SI SEGNA «FATTO», E CHI GUARDA I 14 GIORNI.
 *
 * Chi ha pagato in contanti riavrà i soldi con un bonifico fatto a mano. La pagina dove si segna
 * «Fatto» (/admin/bonifici-rimborso, migrazione 910) c'era, ma:
 *  · l'avviso del bonifico portava all'elenco degli ordini, e la barra laterale non la nominava;
 *  · il termine lo guardava solo chi apriva la pagina: il sorvegliante non lo leggeva mai;
 *  · per un bonifico nato da un reclamo il termine era «sconosciuto» (la 910 dava il giorno solo ai
 *    resi), quindi nessun allarme poteva scattare, e l'avviso diceva «il termine non lo sappiamo».
 *
 * Da dove contano i 14 giorni di un reclamo è una DOMANDA APERTA A NICOLA: la regola sta in una
 * costante sola (PARTENZA_DEL_TERMINE_DEI_RECLAMI, oggi «apertura»), e qui si provano tutte e due.
 *
 * Gira il sorvegliante VERO con un database finto, e la rotta VERA dei reclami con `refundOrder` vera.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

const finti = vi.hoisted(() => ({
  modo: 'sorvegliante' as 'sorvegliante' | 'reclami',
  db: null as unknown as FintoDatabase,
  rispostaBonifici: { data: [] as unknown, error: null as unknown },
}));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'x' })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (g: (r: unknown) => unknown) => (r: unknown) => g(r),
  withAdminAuth:
    (handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: 'nicola' }, req, params: (await ctx?.params) ?? {} }),
}));

/** Il database del sorvegliante: ogni lettura risponde vuota, la campanella e la memoria accettano. */
function tabellaDelSorvegliante(nome: string): unknown {
  const chiamate: Array<{ m: string; a: unknown[] }> = [];
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') {
        let esito: { data: unknown; error: unknown } = { data: [], error: null };
        if (nome === 'profiles' && chiamate.some((x) => x.m === 'eq' && x.a[1] === 'admin')) esito = { data: [{ id: 'admin-1' }], error: null };
        else if (nome === 'categories') esito = { data: [{ id: 'cat-1' }], error: null };
        else if (nome === 'operational_alert_log' && chiamate.some((x) => x.m === 'upsert' || x.m === 'insert' || x.m === 'update')) {
          const riga = (chiamate.find((x) => x.m === 'upsert' || x.m === 'insert')?.a[0] ?? []) as unknown;
          esito = { data: ([] as Array<{ alert_key: string }>).concat(riga as never), error: null };
        }
        const p = Promise.resolve(esito);
        return p.then.bind(p);
      }
      if (typeof k === 'symbol') return undefined;
      return (...a: unknown[]) => { chiamate.push({ m: String(k), a }); return c; };
    },
  });
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () =>
    finti.modo === 'reclami'
      ? finti.db.client
      : {
          from: (t: string) => tabellaDelSorvegliante(t),
          rpc: async (nome: string) =>
            nome === 'admin_bonifici_rimborso' ? finti.rispostaBonifici : { data: null, error: { message: `rpc finta: ${nome}` } },
        },
}));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { POST as risolvi } from '@/app/api/admin/disputes/[id]/resolve/route';
import {
  PAGINA_DEI_BONIFICI,
  PARTENZA_DEL_TERMINE_DEI_RECLAMI,
  allarmiDeiBonifici,
  avvisoDelBonificoDaFare,
  elencoDeiBonifici,
  type RigaDelBonifico,
} from '@/lib/rimborsi/bonifici-da-fare';

const ADESSO = new Date('2026-11-22T10:00:00Z');

/** Un bonifico da 10 € nato da un reclamo aperto il 1° novembre e deciso il 20 (righe della migrazione 999o). */
function bonificoDelReclamo(extra: Partial<RigaDelBonifico> = {}): RigaDelBonifico {
  return {
    order_id: 'abcdef12-0000-0000-0000-000000000001',
    chiave: 'dispute_d1d1d1d1-0000-0000-0000-000000000001',
    centesimi: 1000,
    cliente_nome: 'Mario Rossi',
    cliente_email: 'mario@esempio.it',
    chiesto_il: null,
    stato: 'DA_FARE',
    fatto_da_nome: null,
    fatto_il: null,
    respinto_da_nome: null,
    respinto_il: null,
    reclamo_aperto_il: '2026-11-01T08:30:00Z',
    reclamo_deciso_il: '2026-11-20T16:00:00Z',
    ...extra,
  };
}

const salvato = { ...process.env };

beforeEach(() => {
  finti.modo = 'sorvegliante';
  finti.rispostaBonifici = { data: [], error: null };
  for (const v of ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_DSN', 'VERCEL_ENV', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'AI_GLOBAL_DAILY_BUDGET_EUR']) delete process.env[v];
  process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
  process.env.LAVORI_A_ORARIO = 'accesi';
  vi.stubGlobal('fetch', vi.fn(async (u: unknown) => { throw new Error(`rete vera chiesta: ${String(u)}`); }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...salvato };
  vi.unstubAllGlobals();
});

describe('il termine dei 14 giorni di un reclamo', () => {
  it('la regola di oggi è «dall apertura», e sta in un posto solo (domanda aperta a Nicola)', () => {
    expect(PARTENZA_DEL_TERMINE_DEI_RECLAMI).toBe('apertura');
  });

  it('dall apertura: aperto il 1° novembre, il termine è il 15 ed è passato da 7 giorni', () => {
    const [b] = elencoDeiBonifici([bonificoDelReclamo()], ADESSO).daFare;
    expect(b.termine, 'il reclamo ha ancora il termine sconosciuto').not.toBeNull();
    expect(b.urgenza).toEqual({ tipo: 'passato', giorni: 7 });
    expect(b.inEvidenza).toBe(true);
  });

  it('se Nicola dice «dalla decisione»: deciso il 20, il termine è il 4 dicembre e c è tempo', () => {
    const [b] = elencoDeiBonifici([bonificoDelReclamo()], ADESSO, 'decisione').daFare;
    expect(b.urgenza).toEqual({ tipo: 'in_tempo', giorni: 12 });
    expect(allarmiDeiBonifici([bonificoDelReclamo()], ADESSO, 'decisione')).toEqual([]);
  });

  it('prima della migrazione 999o (niente date del reclamo) il termine resta sconosciuto, come prima', () => {
    const riga = bonificoDelReclamo();
    delete riga.reclamo_aperto_il;
    delete riga.reclamo_deciso_il;
    const [b] = elencoDeiBonifici([riga], ADESSO).daFare;
    expect(b.urgenza).toEqual({ tipo: 'sconosciuto' });
  });

  it('un reso conta sempre dalla richiesta, anche se la riga portasse date di reclamo', () => {
    const reso = bonificoDelReclamo({ chiave: 'return_r1', chiesto_il: '2026-11-15T09:00:00Z' });
    const [b] = elencoDeiBonifici([reso], ADESSO).daFare;
    expect(b.urgenza).toEqual({ tipo: 'in_tempo', giorni: 7 });
  });

  it('l allarme del reclamo scaduto porta alla pagina dei bonifici', () => {
    const [allarme] = allarmiDeiBonifici([bonificoDelReclamo()], ADESSO);
    expect(allarme).toMatchObject({
      type: 'BONIFICO_RIMBORSO_SCADUTO',
      key: 'BONIFICO_RIMBORSO_SCADUTO|dispute_d1d1d1d1-0000-0000-0000-000000000001',
      url: PAGINA_DEI_BONIFICI,
      unaVoltaAlGiorno: true,
    });
    expect(allarme.detail).toContain('Termine passato da 7 giorni');
  });
});

describe('il sorvegliante guarda i bonifici di rimborso', () => {
  async function giro() {
    const res = await sorvegliante({ url: 'http://localhost/api/cron/operational-alerts', headers: new Headers() } as unknown as NextRequest);
    return { http: res.status, corpo: (await res.json()) as { details?: Array<{ type: string; detail: string }>; controlliSaltati?: string[] } };
  }
  const tipi = (corpo: { details?: Array<{ type: string }> }) => (corpo.details ?? []).map((d) => d.type);

  it('un bonifico di reclamo da fare col termine passato fa suonare l allarme', async () => {
    finti.rispostaBonifici = { data: [bonificoDelReclamo()], error: null };
    const { corpo } = await giro();
    expect(tipi(corpo), 'il sorvegliante non guarda i bonifici di rimborso').toContain('BONIFICO_RIMBORSO_SCADUTO');
    expect(corpo.details?.find((d) => d.type === 'BONIFICO_RIMBORSO_SCADUTO')?.detail).toContain('ancora da fare');
  });

  it('un reso a 2 giorni dal termine: allarme «in scadenza»; uno già fatto: niente', async () => {
    finti.rispostaBonifici = {
      data: [
        bonificoDelReclamo({ chiave: 'return_r1', chiesto_il: '2026-11-10T09:00:00Z', reclamo_aperto_il: null, reclamo_deciso_il: null }),
        bonificoDelReclamo({ stato: 'FATTO', fatto_il: '2026-11-21T09:00:00Z', fatto_da_nome: 'Anna' }),
      ],
      error: null,
    };
    const { http, corpo } = await giro();
    expect(tipi(corpo)).toContain('BONIFICO_RIMBORSO_IN_SCADENZA');
    expect(tipi(corpo)).not.toContain('BONIFICO_RIMBORSO_SCADUTO');
    expect(corpo.controlliSaltati ?? []).not.toContain('bonifici di rimborso');
    expect(http).toBe(200);
  });

  it('senza la migrazione 910 (la funzione non c è) il controllo tace e il giro non risulta incompleto', async () => {
    finti.rispostaBonifici = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_bonifici_rimborso' } };
    const { http, corpo } = await giro();
    expect(corpo.controlliSaltati ?? []).not.toContain('bonifici di rimborso');
    expect(tipi(corpo)).not.toContain('SORVEGLIANTE_INCOMPLETO');
    expect(http).toBe(200);
  });

  it('una lettura caduta per altro è un controllo saltato, detto', async () => {
    finti.rispostaBonifici = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const { http, corpo } = await giro();
    expect(corpo.controlliSaltati ?? []).toContain('bonifici di rimborso');
    expect(tipi(corpo)).toContain('SORVEGLIANTE_INCOMPLETO');
    expect(http).toBe(500);
  });
});

describe('l avviso del bonifico porta dove si segna «Fatto», e dice il termine anche per un reclamo', () => {
  it('il link è la pagina dei bonifici, non l elenco degli ordini', () => {
    const avviso = avvisoDelBonificoDaFare({ ordineId: 'o1', bonificoCents: 1000, creditoCents: 0, emailCliente: 'm@e.it', chiave: 'return_r1' });
    expect(avviso.link).toBe(PAGINA_DEI_BONIFICI);
    expect(avviso.testo).toContain('premi «Fatto» nella pagina «Bonifici di rimborso»');
  });

  it('con la regola «dalla decisione» la frase dice «deciso», non «aperto»', () => {
    const avviso = avvisoDelBonificoDaFare({
      ordineId: 'o1', bonificoCents: 1000, creditoCents: 0, emailCliente: 'm@e.it', chiave: 'dispute_d1',
      resoChiestoIl: '2026-11-20T16:00:00Z', partenzaDeiReclami: 'decisione', adesso: ADESSO,
    });
    expect(avviso.testo).toContain('Il reclamo è stato deciso il 20 novembre 2026');
    expect(avviso.testo).toContain('il termine è il 4 dicembre 2026');
  });

  function ordineInContantiIncassato(): Riga {
    return {
      id: 'o1', user_id: 'cliente', seller_id: 'negozio',
      total_price: 24, gross_total_cents: 2400, wallet_applied_cents: 0,
      seller_payout_cents: 2160, seller_payout_reversed_cents: 0, payout_status: 'HELD',
      stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null,
      refunded_amount_cents: 0, payment_method: 'cod',
      rider_id: 'rider', rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
      rider_fee_cents: 300, shipping_cost: 3,
      delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-30T18:00:00Z',
    };
  }

  it('la rotta dei reclami passa il giorno dell apertura: l avviso dice il termine, già passato', async () => {
    finti.modo = 'reclami';
    finti.db = creaFintoDatabase({
      orders: [ordineInContantiIncassato()],
      disputes: [{ id: 'd1', status: 'open', order_id: 'o1', opener_id: 'cliente', against_id: 'negozio', created_at: '2026-11-01T08:30:00Z' }],
      profiles: [{ id: 'nicola', role: 'admin' }],
      notifications: [],
    });
    const req = new Request('http://localhost/api/admin/disputes/d1/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved_buyer', notes: 'Mai arrivato: a favore del cliente.', refundCents: 2400 }),
    });
    const res = await risolvi(req as never, { params: Promise.resolve({ id: 'd1' }) });
    expect(res.status).toBe(200);

    const [avviso] = notificheConTitolo(finti.db, 'Bonifico di rimborso da fare');
    expect(avviso, 'nessun avviso del bonifico').toBeTruthy();
    const testo = String(avviso.body);
    expect(testo, 'il reclamo arriva ancora col termine sconosciuto').not.toContain('Il termine non lo sappiamo');
    expect(testo).toContain('Il reclamo è stato aperto il 1 novembre 2026');
    expect(testo).toContain('il termine è il 15 novembre 2026');
    expect(testo).toContain('Termine passato da 7 giorni');
    expect(avviso.link).toBe(PAGINA_DEI_BONIFICI);
  });
});
