import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import type { VoceDaBonificare } from '@/lib/rimborsi/bonifici-da-fare';

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown) =>
    async (req: Request) => h({ user: { id: 'nicola' }, req, params: {} }),
}));

import { GET as lista } from '@/app/api/admin/rimborsi-da-bonificare/route';

/**
 * Riesame del 16/10, sesto giro — LA LISTA DEI BONIFICI NASCE SOLO DAL SEGNO SULL'ORDINE.
 *
 * In produzione la migrazione 153 non c'e': un cliente puo' scriversi da solo righe di reso intere,
 * stato «rimborsato» e segno `bonifico:` compresi. Il terzo giro le aveva spostate in un riquadro
 * «da controllare prima di pagare», ma da li' nascevano tre difetti:
 *
 *  ① il riquadro diceva «cerca l'avviso fra le Notifiche: se non c'e', non pagare», e l'avviso puo'
 *    mancare davvero (le Notifiche ne mostrano 50, e la sua scrittura e' facoltativa);
 *  ② una riga finta non si toglieva: l'unico pulsante era «Bonifico fatto», che scrive nel
 *    registro un rimborso mai fatto;
 *  ③ la lettura dei resi si fermava a mille righe, ordinate per data: Mallory ne scrive mille con
 *    la data del 2099 e il bonifico vero di Giulia, 40 € con l'IBAN, non veniva nemmeno letto.
 *
 * Adesso le voci dei resi nascono solo dai segni nell'elenco dei rimborsi degli ordini, che il
 * cliente non puo' scrivere (tests/sql/rls/43). Gira la rotta vera su un finto database che applica
 * filtri, tetti e pagine; le righe finte stanno PRIMA di quella vera, come le darebbe il database
 * ordinato per data.
 */

const ORDINE_DI_GIULIA = '11111111-1111-4111-8111-111111111111';
const RESO_DI_GIULIA = '22222222-2222-4222-8222-222222222222';
const ORDINE_DI_MALLORY = '33333333-3333-4333-8333-333333333333';
const IBAN_DI_GIULIA = 'IT60X0542811101000000123456';
const SEGNO_DI_GIULIA = `bonifico:4000:return_${RESO_DI_GIULIA}`;

function rigaDiMallory(i: number, segno?: string): Riga {
  const id = `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`;
  return {
    id, order_id: ORDINE_DI_MALLORY, buyer_id: 'mallory', status: 'REFUNDED', refund_amount_cents: 1,
    refunded_at: '2099-01-01T00:00:00Z', refund_id: segno ?? `bonifico:1:return_${id}`, refund_method: 'BONIFICO',
    refund_iban: 'DE89370400440532013000', refund_bonifico_cents: 1, refund_bonifico_fatto_at: null,
  };
}

const resoDiGiulia: Riga = {
  id: RESO_DI_GIULIA, order_id: ORDINE_DI_GIULIA, buyer_id: 'giulia', status: 'REFUNDED', refund_amount_cents: 4000,
  refunded_at: '2026-10-15T10:00:00Z', refund_id: SEGNO_DI_GIULIA, refund_method: 'BONIFICO', refund_iban: IBAN_DI_GIULIA,
  refund_bonifico_cents: 4000, refund_bonifico_fatto_at: null,
};

function mondo(righeDiMallory: Riga[]) {
  finto.db = creaFintoDatabase({
    orders: [
      // L'ordine di Mallory non e' mai stato rimborsato: il suo elenco dei rimborsi e' vuoto.
      { id: ORDINE_DI_MALLORY, stripe_refund_id: null },
      // Quello di Giulia porta il segno che ha scritto `refundOrder`.
      { id: ORDINE_DI_GIULIA, stripe_refund_id: SEGNO_DI_GIULIA },
    ],
    returns: [...righeDiMallory, resoDiGiulia],
    bonifici_dei_reclami: [],
  });
}

async function leggi(): Promise<{ voci: VoceDaBonificare[]; corpo: Record<string, unknown> }> {
  const res = await (lista as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/api/admin/rimborsi-da-bonificare'));
  expect(res.status).toBe(200);
  const corpo = (await res.json()) as Record<string, unknown>;
  return { voci: corpo.voci as VoceDaBonificare[], corpo };
}

beforeEach(() => mondo([]));

describe('③ mille resi scritti dal cliente non nascondono il bonifico vero', () => {
  it('IL CASO CHE ROMPEVA — mille righe del 2099 prima di Giulia: il suo bonifico da 40 € c e, con l IBAN', async () => {
    mondo(Array.from({ length: 1000 }, (_, i) => rigaDiMallory(i)));
    expect(finto.db.tabelle.returns, 'le righe finte non ci sono: la prova non misura il caso').toHaveLength(1001);

    const { voci, corpo } = await leggi();
    const giulia = voci.find((v) => v.id === RESO_DI_GIULIA);
    expect(giulia, 'il bonifico vero di Giulia non e nella lista').toMatchObject({ importoCents: 4000, daFare: true });
    expect(String(giulia?.iban).replace(/\s/g, '')).toBe(IBAN_DI_GIULIA);
    expect(voci, 'nella lista c e altro oltre al bonifico vero').toHaveLength(1);
    expect(corpo.tagliata, 'la pagina direbbe che la lista e tagliata da righe finte').toBe(false);
  });

  it('controllo: senza le righe finte la voce di Giulia e la stessa', async () => {
    const { voci } = await leggi();
    expect(voci.map((v) => v.id)).toEqual([RESO_DI_GIULIA]);
  });
});

describe('② una riga finta non arriva a chi paga: non c e niente da togliere', () => {
  it('IL CASO CHE ROMPEVA — 950 € scritti da Mallory: non sono fra le voci, e la risposta non ha un riquadro a parte', async () => {
    mondo([{ ...rigaDiMallory(1), refund_id: `bonifico:95000:return_${rigaDiMallory(1).id}`, refund_bonifico_cents: 95000 }]);
    const { voci, corpo } = await leggi();
    expect(voci.map((v) => v.id)).toEqual([RESO_DI_GIULIA]);
    expect(corpo.daControllare, 'la rotta manda ancora un riquadro «da controllare»').toBeUndefined();
    expect(JSON.stringify(corpo), 'la riga finta arriva alla pagina').not.toContain('95000');
  });

  it('nemmeno se copia il segno del rimborso vero di Giulia', async () => {
    mondo([rigaDiMallory(2, SEGNO_DI_GIULIA)]);
    const { voci } = await leggi();
    expect(voci.map((v) => v.id), 'la copia del segno passa per un bonifico, o Giulia compare due volte').toEqual([RESO_DI_GIULIA]);
  });
});

describe('① il segno sull ordine non si e scritto: la lista non dice di non pagare', () => {
  it('il bonifico non c e, e nessuna frase della risposta dice «non pagare»', async () => {
    finto.db.tabelle.orders[1].stripe_refund_id = null;
    const { voci, corpo } = await leggi();
    expect(voci).toHaveLength(0);
    expect(JSON.stringify(corpo)).not.toMatch(/non pagar/u);
    // A chi amministra lo dice il server, con un avviso apposta: la-pagina-dei-bonifici-manda-dove-le-cose-sono.test.ts.
  });
});

describe('la cifra viene dal segno sull ordine, non dalla riga del reso', () => {
  it('una riga del reso con una cifra diversa non cambia quanto si paga', async () => {
    finto.db.tabelle.returns[0].refund_bonifico_cents = 95000;
    const { voci } = await leggi();
    expect(voci[0].importoCents).toBe(4000);
  });

  it('il reso senza il segno sulla riga (scrittura caduta): la voce c e, e va registrata sul reso', async () => {
    finto.db.tabelle.returns[0].refund_id = null;
    finto.db.tabelle.returns[0].status = 'APPROVED';
    const { voci } = await leggi();
    expect(voci[0]).toMatchObject({ id: RESO_DI_GIULIA, importoCents: 4000, daRegistrareSulReso: true });
  });
});

describe('la regola, come funzione: una voce per ogni segno sull ordine, e nient altro', () => {
  it('una riga di reso col suo segno, che nessun ordine porta, non diventa una voce anche se arriva fra le righe lette', async () => {
    const { bonificiDeiResiDagliOrdini } = await import('@/lib/rimborsi/bonifici-da-fare');
    const finta = rigaDiMallory(7);
    const righe = bonificiDeiResiDagliOrdini(
      [{ id: ORDINE_DI_MALLORY, stripe_refund_id: null }, { id: ORDINE_DI_GIULIA, stripe_refund_id: SEGNO_DI_GIULIA }],
      [finta as never, resoDiGiulia as never],
    );
    expect(righe.map((r) => r.id)).toEqual([RESO_DI_GIULIA]);
    expect(righe[0]).toMatchObject({ refund_id: SEGNO_DI_GIULIA, refund_bonifico_cents: 4000, refund_iban: IBAN_DI_GIULIA });
  });
});
