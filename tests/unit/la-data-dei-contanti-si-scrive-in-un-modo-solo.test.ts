import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 31/10/2026 (ondata 5, collaudo del pacchetto «lib/stripe/payout.ts», secondo
 * giro) — IL GIORNO DA CUI STRIPE PAGA I CONTANTI SI SCRIVE IN UN MODO SOLO.
 *
 * La variabile PAGAMENTI_CONTANTI_DA_STRIPE_DAL si leggeva con `Date.parse`:
 *  · «01/12/2026» (il primo dicembre, scritto all'italiana) diventava il
 *    12 gennaio, e un contrassegno del 10 novembre già girato a mano da Nicola
 *    ripartiva da Stripe: il negozio veniva pagato due volte;
 *  · «2026-12-01» valeva dalla mezzanotte di Greenwich, cioè dall'una di
 *    Piacenza: la consegna delle 00:30 del primo dicembre restava fuori.
 * Adesso vale solo AAAA-MM-GG, dalla mezzanotte di Piacenza; il resto vale come
 * «non messa» e il log dice il valore letto. E la variabile è scritta in
 * .env.example, col formato e con quando accenderla.
 */

const VAR = 'PAGAMENTI_CONTANTI_DA_STRIPE_DAL';

let finto: FintoDatabase;
const transfersCreate = vi.fn(async (_corpo: Record<string, unknown>, _opz?: unknown) => ({ id: 'tr_nuovo' }));
const registro = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ transfers: { create: transfersCreate, list: async () => ({ data: [] }) } }),
}));
vi.mock('@/lib/logger', () => ({ logger: registro }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { releaseOrderPayout } from '@/lib/stripe/payout';

function contrassegno(consegnatoIl: string): Riga {
  return {
    id: 'o_cod', seller_id: 's1', payout_status: 'HELD', delivery_status: 'DELIVERED',
    payment_method: 'cod', delivered_at: consegnatoIl, stripe_charge_id: null,
    seller_payout_cents: 13500, seller_payout_reversed_cents: 0, payout_tentativo: 0,
    stripe_transfer_group: 'order_o_cod', payout_claimed_at: null,
  };
}

async function pagaIlContrassegno(dal: string, consegnatoIl: string) {
  vi.stubEnv(VAR, dal);
  finto = fintoDatabase({
    orders: [contrassegno(consegnatoIl)],
    profiles: [{ id: 's1', stripe_account_id: 'acct_s1', stripe_payouts_enabled: true }],
  });
  return releaseOrderPayout('o_cod');
}

/** Tutto quello che il codice ha scritto nel log, in un testo solo. */
const logScritto = () => JSON.stringify([...registro.error.mock.calls, ...registro.warn.mock.calls]);

beforeEach(() => {
  transfersCreate.mockClear();
  registro.error.mockClear();
  registro.warn.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('un giorno scritto in un altro formato vale come «non messa»', () => {
  // Il 10 novembre il negozio ha già avuto i soldi a mano: nessuno di questi deve ripagarlo.
  const giaPagatoAMano = '2026-11-10T10:00:00.000Z';

  it.each([
    ['01/12/2026', 'il primo dicembre all italiana: per Date.parse e il 12 gennaio'],
    ['12/01/2026', 'stesso giorno, scritto all americana'],
    ['2026-12-01T00:00:00Z', 'giorno con l ora: non e AAAA-MM-GG'],
    ['2026-02-30', 'un giorno che non esiste'],
    ['dicembre', 'una parola'],
    ['', 'vuota'],
  ])('«%s» (%s): il contrassegno pagato a mano non riparte da Stripe', async (dal) => {
    const esito = await pagaIlContrassegno(dal, giaPagatoAMano);
    expect(esito.ok, `con ${VAR}=«${dal}» il negozio riceve una seconda volta i contanti`).toBe(false);
    expect(transfersCreate).not.toHaveBeenCalled();
    expect(finto.tabelle.orders[0].payout_status).toBe('HELD');
  });

  it('il log dice il valore letto, cosi chi l ha scritto male lo vede', async () => {
    await pagaIlContrassegno('01/12/2026', giaPagatoAMano);
    expect(logScritto(), 'nessuna traccia di «01/12/2026» nel log: la data storta resta invisibile').toContain('01/12/2026');
    expect(logScritto()).toContain(VAR);
  });

  it('anche il giorno con l ora finisce nel log col valore letto', async () => {
    await pagaIlContrassegno('2026-12-01T00:00:00Z', '2026-12-05T10:00:00.000Z');
    expect(transfersCreate).not.toHaveBeenCalled();
    expect(logScritto()).toContain('2026-12-01T00:00:00Z');
  });
});

describe('AAAA-MM-GG vale dalla mezzanotte di Piacenza', () => {
  it('consegnato il primo dicembre alle 00:30 di Piacenza: lo paga Stripe', async () => {
    // 00:30 del 1/12 a Piacenza (ora solare, +1) = 23:30 del 30/11 a Greenwich.
    const esito = await pagaIlContrassegno('2026-12-01', '2026-11-30T23:30:00.000Z');
    expect(esito, 'la consegna delle 00:30 resta fuori: il giorno valeva dall una di notte').toEqual({ ok: true, transferId: 'tr_nuovo' });
    expect(transfersCreate).toHaveBeenCalledTimes(1);
  });

  it('consegnato il 30 novembre alle 23:30 di Piacenza: resta a mano', async () => {
    const esito = await pagaIlContrassegno('2026-12-01', '2026-11-30T22:30:00.000Z');
    expect(esito.ok).toBe(false);
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it('d estate la mezzanotte di Piacenza e alle 22 di Greenwich', async () => {
    // 00:30 del 1/7 a Piacenza (ora legale, +2) = 22:30 del 30/6 a Greenwich.
    expect((await pagaIlContrassegno('2026-07-01', '2026-06-30T22:30:00.000Z')).ok).toBe(true);
    transfersCreate.mockClear();
    // 23:30 del 30/6 a Piacenza = 21:30 del 30/6 a Greenwich.
    expect((await pagaIlContrassegno('2026-07-01', '2026-06-30T21:30:00.000Z')).ok).toBe(false);
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it('uno spazio in fondo (copiato da un messaggio) non cambia il giorno', async () => {
    expect((await pagaIlContrassegno('2026-12-01 ', '2026-12-02T10:00:00.000Z')).ok).toBe(true);
  });
});

describe('la variabile e scritta in .env.example', () => {
  const righe = readFileSync(join(process.cwd(), '.env.example'), 'utf8').split('\n');
  const dove = righe.findIndex((r) => r.startsWith(`${VAR}=`));
  // Il commento che la spiega sono le righe «#» subito sopra.
  const commento: string[] = [];
  for (let i = dove - 1; i >= 0 && righe[i].startsWith('#'); i--) commento.unshift(righe[i]);
  const spiegazione = commento.join('\n');

  it('c e, ed e vuota: copiare l esempio non accende i contanti da Stripe', () => {
    expect(dove, `${VAR} manca da .env.example: il giorno in cui la si accende nessuno sa come scriverla`).toBeGreaterThan(-1);
    expect(righe[dove].slice(VAR.length + 1).trim()).toBe('');
  });

  it('il giorno d esempio scritto nel commento funziona davvero, dalla mezzanotte di Piacenza', async () => {
    expect(spiegazione).toMatch(/AAAA-MM-GG/);
    const esempio = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(spiegazione);
    expect(esempio, 'il commento non mostra un giorno d esempio nel formato giusto').not.toBeNull();
    const [, a, m, g] = esempio!;
    const mezzanotteUtc = Date.UTC(Number(a), Number(m) - 1, Number(g));
    // Mezzanotte di Piacenza = Greenwich meno lo scarto del fuso (1 o 2 ore).
    const scartoOre = new Date(mezzanotteUtc).toLocaleString('en-US', { timeZone: 'Europe/Rome', hour: 'numeric', hourCycle: 'h23' });
    const mezzanotteDiPiacenza = mezzanotteUtc - Number(scartoOre) * 3_600_000;
    expect((await pagaIlContrassegno(esempio![0], new Date(mezzanotteDiPiacenza + 30 * 60_000).toISOString())).ok).toBe(true);
    transfersCreate.mockClear();
    expect((await pagaIlContrassegno(esempio![0], new Date(mezzanotteDiPiacenza - 30 * 60_000).toISOString())).ok).toBe(false);
  });

  it('dice quando accenderla: dopo l ultimo bonifico dei contanti fatto a mano', () => {
    expect(spiegazione).toMatch(/Europe\/Rome/);
    expect(spiegazione).toMatch(/pagamenti\.bonifico-contanti-al-negozio/);
    expect(spiegazione).toMatch(/lunedì/);
  });
});
