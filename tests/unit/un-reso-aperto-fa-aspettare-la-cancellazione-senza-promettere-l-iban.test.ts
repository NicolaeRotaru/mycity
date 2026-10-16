import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: vi.fn() }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const passa = (h: Gestore) => async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
    h({ user: { id: 'nicola' }, req, params: (await ctx?.params) ?? {} });
  return { withAdminAuth: passa, withAdminAuthRateLimit: (_o: unknown, h: Gestore) => passa(h) };
});

import { cancellaAccount } from '@/lib/account/cancellazione';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import {
  SE_CANCELLI_L_ACCOUNT_CON_UN_BONIFICO_DA_FARE,
  rinvioPerLaPersona,
} from '@/lib/rimborsi/iban-del-rimborso';
import { POST as comandoDellaLista } from '@/app/api/admin/rimborsi-da-bonificare/route';
import { DELETE as cancellaDalPannello } from '@/app/api/admin/users/[id]/delete/route';

/**
 * Riesame del 16/10, quinto giro — PER UN RESO APERTO LA CANCELLAZIONE PROMETTEVA DI RIPARTIRE CON L'IBAN.
 *
 * Giulia paga 40 € in contanti, apre un reso senza scegliere come riavere i soldi (da una pagina
 * vecchia), il negozio lo approva e il reso resta aperto. Giulia chiede di cancellare l'account. La
 * cancellazione aspetta, giustamente: se il negozio la rimborsa sara' con un bonifico, e senza
 * l'account non sapremmo a chi farlo. Ma le diceva «mandaci l'IBAN: la cancellazione riparte da sola
 * quando avremo l'IBAN». Su un reso aperto l'IBAN non ha un posto: la lista dei bonifici ha solo i
 * rimborsi fatti, e il comando che salva l'IBAN rispondeva «gia' fatto, oppure non e' un rimborso da
 * bonificare». Giulia mandava l'IBAN e non ripartiva niente. E se a cancellare era chi amministra, la
 * risposta era la stessa frase scritta per Giulia.
 *
 * Adesso la frase dice la condizione vera — riparte quando non ci sono piu' bonifici da farle — e la
 * prova la mantiene: chiuso il reso senza rimborso la cancellazione riparte; rimborsato col
 * bonifico, riparte quando chi paga lo segna fatto (riesame del 16/10, sesto giro: l'IBAN da solo
 * non basta piu', la cancellazione aspetta il bonifico).
 */

const GIULIA = 'giulia-0000-4000-8000-000000000001';
const ORDINE = '11111111-1111-4111-8111-111111111111';
const RESO = '22222222-2222-4222-8222-222222222222';
const IBAN = 'IT60X0542811101000000123456';

function mondo(reso: Riga, ordine: Riga = {}) {
  finto.db = creaFintoDatabase({
    cod_reconciliations: [],
    orders: [{
      id: ORDINE, user_id: GIULIA, delivery_full_name: 'Giulia Verdi', payment_method: 'cod', stripe_payment_intent: null,
      total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0, delivery_status: 'DELIVERED', payment_status: 'PAID',
      stripe_refund_id: null, ...ordine,
    }],
    returns: [{
      id: RESO, order_id: ORDINE, buyer_id: GIULIA, status: 'APPROVED', refund_id: null, refund_method: null, refund_iban: null,
      refund_intestatario: null, refund_bonifico_cents: null, refund_bonifico_fatto_at: null, refund_amount_cents: 4000,
      refunded_at: null, ...reso,
    }],
    disputes: [],
    bonifici_dei_reclami: [],
    profiles: [{ id: GIULIA, full_name: 'Giulia Verdi', role: 'buyer' }],
  });
  const auth = finto.db.client.auth.admin as unknown as Record<string, unknown>;
  auth.deleteUser = async () => ({ error: null });
}

async function segnaFatto() {
  const res = await (comandoDellaLista as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resoId: RESO }),
    }),
    undefined,
  );
  return res.status;
}

async function salvaLIban() {
  const res = await (comandoDellaLista as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resoId: RESO, azione: 'iban', iban: IBAN }),
    }),
    undefined,
  );
  return res.status;
}

beforeEach(() => mondo({}));

describe('la cancellazione che aspetta un reso aperto dice la condizione vera, e la mantiene', () => {
  it('IL CASO CHE ROMPEVA — la frase non promette che basti l IBAN: dice che il reso deve chiudersi', async () => {
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(esito.motivo, 'la cancellazione non aspetta: la prova non misura il caso').toBe('bonifico_da_fare');
    expect(esito.errore).toContain('reso ancora aperto');
    expect(esito.errore, 'promette di ripartire con l IBAN, che su un reso aperto non si puo salvare').not.toMatch(/riparte da sola quando avremo l.IBAN/u);
    expect(esito.errore).toMatch(/riparte da sola quando non ci saranno più bonifici da farti/u);

    // Ed e' vero che l'IBAN, adesso, non si salva: e' il motivo per cui la frase non lo promette.
    expect(await salvaLIban()).toBe(409);
  });

  it('la promessa si mantiene: chiuso il reso senza rimborso, la cancellazione riparte', async () => {
    expect((await cancellaAccount(finto.db.client as never, GIULIA)).motivo).toBe('bonifico_da_fare');
    finto.db.tabelle.returns[0].status = 'REJECTED';
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(esito.ok, esito.errore).toBe(true);
  });

  it('la promessa si mantiene: rimborsato col bonifico, aspetta, e riparte quando chi paga lo segna fatto', async () => {
    const segno = `bonifico:4000:return_${RESO}`;
    mondo(
      { status: 'REFUNDED', refund_id: segno, refund_bonifico_cents: 4000, refunded_at: '2026-10-15T10:00:00Z' },
      { stripe_refund_id: segno, payment_status: 'REFUNDED' },
    );
    const prima = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(prima.motivo).toBe('bonifico_da_fare');

    // L'IBAN da solo non la fa ripartire: il bonifico e' ancora da fare.
    expect(await salvaLIban()).toBe(200);
    expect((await cancellaAccount(finto.db.client as never, GIULIA)).motivo).toBe('bonifico_da_fare');

    expect(await segnaFatto()).toBe(200);
    const dopo = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(dopo.ok, dopo.errore).toBe(true);
  });
});

describe('cancellata dal pannello, la risposta e scritta per chi amministra', () => {
  it('IL CASO CHE ROMPEVA — la rotta rispondeva con la frase scritta per la cliente, e troppo lunga per la pagina', async () => {
    const res = await (cancellaDalPannello as unknown as (r: Request, c: unknown) => Promise<Response>)(
      new Request(`http://localhost/api/admin/users/${GIULIA}/delete`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: GIULIA }) },
    );
    const corpo = (await res.json()) as { error?: { message?: string } };
    const perLaCliente = (await cancellaAccount(finto.db.client as never, GIULIA)).errore;

    expect(res.status).toBe(409);
    expect(corpo.error?.message, 'a chi amministra arriva la frase scritta per la cliente').not.toBe(perLaCliente);
    // Quello che la pagina mostra (app/admin/users/page.tsx): sopra i 200 caratteri, il testo generico.
    const aVideo = friendlyError(new Error(apiErrorMessage(corpo, 'Eliminazione fallita')));
    expect(aVideo, 'la pagina mostra «Qualcosa non ha funzionato» al posto del motivo').toBe(corpo.error?.message);
    expect(aVideo).toContain('reso aperto');
  });
});

describe('le parole, in ogni combinazione', () => {
  it('bonifici dovuti, reso aperto, o tutti e due: nessuna promessa che basti l IBAN', () => {
    const dovuti = rinvioPerLaPersona({ centesimi: 2400, incerti: 0, resiAperti: 0, reclamiAperti: 0, con162: true });
    const aperto = rinvioPerLaPersona({ centesimi: 0, incerti: 0, resiAperti: 1, reclamiAperti: 0, con162: true });
    const tutti = rinvioPerLaPersona({ centesimi: 2400, incerti: 0, resiAperti: 2, reclamiAperti: 0, con162: true });
    for (const frase of [dovuti, aperto, tutti]) {
      expect(frase).not.toMatch(/quando avremo l.IBAN/u);
      expect(frase).toMatch(/riparte da sola quando non ci saranno più bonifici da farti/u);
    }
    expect(aperto).toMatch(/un reso ancora aperto/u);
    expect(tutti).toMatch(/24,00\s€/u);
    expect(tutti).toMatch(/dei resi ancora aperti/u);
    expect(SE_CANCELLI_L_ACCOUNT_CON_UN_BONIFICO_DA_FARE).toMatch(/un reso o un reclamo ancora aperto su un tuo ordine pagato in contanti può finire con un bonifico/u);
  });
});
