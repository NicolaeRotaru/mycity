import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, cancellati: [] as string[] }));

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
import { verdettoDelGiro } from '@/lib/cron-cancellazioni';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { COLONNE_162 } from '@/lib/rimborsi/scelta-del-cliente';
import {
  attesaPerIBonifici,
  iBonificiCheFannoAspettare,
  ilBonificoDelResoEAncoraDaFare,
  rinvioPerChiAmministra,
  rinvioPerLaPersona,
  SE_CANCELLI_L_ACCOUNT_CON_UN_BONIFICO_DA_FARE,
  QUANTO_TENIAMO_L_IBAN,
  type BonificiDaFare,
  type OrdineDellaPersona,
} from '@/lib/rimborsi/iban-del-rimborso';
import { DELETE as cancellaDalPannello } from '@/app/api/admin/users/[id]/delete/route';

/**
 * Riesame del 16/10, sesto giro — LA CANCELLAZIONE DI UN ACCOUNT ASPETTA FINCHE' C'E' UN BONIFICO DA FARE.
 *
 * Una regola sola, al posto di tre. Su un ordine della persona (`orders.user_id`, chi deve ricevere
 * i soldi) c'e' un bonifico di rimborso non segnato fatto, o un reso aperto in contanti che puo'
 * finire con un bonifico? La cancellazione aspetta. Il bonifico lo dice l'elenco dei rimborsi
 * dell'ordine, che c'e' anche senza la migrazione 162. Se non si puo' sapere se e' fatto, si ferma
 * come per un guasto e chi amministra viene avvisato.
 *
 * I quattro difetti che chiude:
 *  ① senza la 162 la custodia non vedeva nessun bonifico: Giulia, con 40 € da riavere, spariva;
 *  ② il bonifico di un reclamo la cui riga non si era scritta non fermava niente;
 *  ③ a chi amministra arrivava una frase di 313 caratteri, che la pagina sostituiva con
 *    «Qualcosa non ha funzionato»;
 *  ④ i bonifici dei reclami si cercavano per chi li aveva aperti: un negozio che apre un reclamo
 *    sull'ordine di un cliente si trovava il debito del cliente, e il cliente no.
 *
 * Girano la cancellazione vera, la rotta vera del pannello, il giro notturno vero e la stessa
 * catena che la pagina usa per mostrare l'errore (`apiErrorMessage` + `friendlyError`).
 */

const GIULIA = 'giulia-0000-4000-8000-000000000001';
const NEGOZIO = 'negozio-000-4000-8000-000000000002';
const ORDINE = '11111111-1111-4111-8111-111111111111';
const RESO = '22222222-2222-4222-8222-222222222222';
const RECLAMO = '33333333-3333-4333-8333-333333333333';
const IBAN = 'IT60X0542811101000000123456';
const SEGNO_DEL_RESO = `bonifico:4000:return_${RESO}`;
const SEGNO_DEL_RECLAMO = `bonifico:2400:dispute_${RECLAMO}`;

function ordine(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: GIULIA, seller_id: NEGOZIO, delivery_full_name: 'Giulia Verdi', delivery_phone: '3331234567',
    payment_method: 'cod', stripe_payment_intent: null, total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    delivery_status: 'DELIVERED', payment_status: 'REFUNDED', stripe_refund_id: SEGNO_DEL_RESO, ...extra,
  };
}

function resoRimborsato(extra: Riga = {}): Riga {
  return {
    id: RESO, order_id: ORDINE, buyer_id: GIULIA, status: 'REFUNDED', refund_id: SEGNO_DEL_RESO, refund_method: 'BONIFICO',
    refund_iban: IBAN, refund_intestatario: null, refund_bonifico_cents: 4000, refund_bonifico_fatto_at: null, ...extra,
  };
}

/** Senza la 162 il reso non ha le sue colonne: solo quelle di sempre. */
function senzaLe162(riga: Riga): Riga {
  return Object.fromEntries(Object.entries(riga).filter(([k]) => !(COLONNE_162 as readonly string[]).includes(k)));
}

function mondo(tabelle: { orders?: Riga[]; returns?: Riga[]; disputes?: Riga[]; bonifici_dei_reclami?: Riga[] }, senza162 = false) {
  finto.cancellati = [];
  finto.db = creaFintoDatabase(
    {
      cod_reconciliations: [],
      orders: tabelle.orders ?? [ordine()],
      returns: tabelle.returns ?? [resoRimborsato()],
      disputes: tabelle.disputes ?? [],
      bonifici_dei_reclami: tabelle.bonifici_dei_reclami ?? [],
      profiles: [
        { id: GIULIA, full_name: 'Giulia Verdi', role: 'buyer' },
        { id: NEGOZIO, full_name: 'Sergio Negoziante', role: 'seller' },
      ],
      contact_messages: [],
    },
    senza162 ? { colonneMancanti: [...COLONNE_162], tabelleMancanti: ['bonifici_dei_reclami'] } : {},
  );
  const auth = finto.db.client.auth.admin as unknown as Record<string, unknown>;
  auth.deleteUser = async (id: string) => {
    finto.cancellati.push(id);
    return { error: null };
  };
}

/** Chi amministra preme «Elimina»: lo stato e la frase che la pagina mostra (app/admin/users/page.tsx). */
async function eliminaDalPannello(userId: string) {
  const res = await (cancellaDalPannello as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request(`http://localhost/api/admin/users/${userId}/delete`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: userId }) },
  );
  const corpo = await res.json();
  const messaggio = apiErrorMessage(corpo, 'Eliminazione fallita');
  return { status: res.status, messaggio, aVideo: friendlyError(new Error(messaggio)) };
}

/** Il giro notturno su questa sola persona. */
function laNotte(esito: { ok: boolean; motivo?: string; errore?: string }) {
  return verdettoDelGiro(
    [{ userId: GIULIA, ok: esito.ok, motivo: esito.motivo as never, errore: esito.errore, chiestaIl: new Date().toISOString() }],
    Date.now(),
    'privacy@example.it',
  );
}

beforeEach(() => mondo({}));

describe('la regola, da sola', () => {
  const o = (extra: Partial<OrdineDellaPersona> = {}): OrdineDellaPersona => ({
    id: ORDINE, payment_method: 'cod', stripe_payment_intent: null, total_price: 40, stripe_refund_id: null, ...extra,
  });
  const reso = (extra: Record<string, unknown> = {}) => ({ id: RESO, order_id: ORDINE, status: 'REFUNDED', refund_id: null, ...extra });
  const nulla = { centesimi: 0, incerti: 0, resiAperti: 0 };

  it.each<[string, Parameters<typeof iBonificiCheFannoAspettare>[0], Partial<BonificiDaFare>]>([
    ['bonifico del reso sull ordine, non fatto', { ordini: [o({ stripe_refund_id: SEGNO_DEL_RESO })], resi: [reso({ refund_id: SEGNO_DEL_RESO, refund_bonifico_fatto_at: null })], reclami: [], con162: true }, { centesimi: 4000, incerti: 0 }],
    ['bonifico del reso fatto', { ordini: [o({ stripe_refund_id: SEGNO_DEL_RESO })], resi: [reso({ refund_id: SEGNO_DEL_RESO, refund_bonifico_fatto_at: '2026-10-16T09:00:00Z' })], reclami: [], con162: true }, nulla],
    ['bonifico del reso fatto, ma senza la 162 non si sa', { ordini: [o({ stripe_refund_id: SEGNO_DEL_RESO })], resi: [reso({ refund_id: SEGNO_DEL_RESO })], reclami: [], con162: false }, { centesimi: 4000, incerti: 1 }],
    ['reso col segno solo sull ordine (la scrittura sul reso era caduta)', { ordini: [o({ stripe_refund_id: SEGNO_DEL_RESO })], resi: [reso({ status: 'APPROVED', refund_bonifico_fatto_at: null })], reclami: [], con162: true }, { centesimi: 4000, incerti: 0, resiAperti: 0 }],
    ['bonifico del reclamo con la sua riga', { ordini: [o({ stripe_refund_id: SEGNO_DEL_RECLAMO })], resi: [], reclami: [{ dispute_id: RECLAMO, order_id: ORDINE, fatto_at: null }], con162: true }, { centesimi: 2400, incerti: 0 }],
    ['bonifico del reclamo senza la sua riga', { ordini: [o({ stripe_refund_id: SEGNO_DEL_RECLAMO })], resi: [], reclami: [], con162: true }, { centesimi: 2400, incerti: 1 }],
    ['riga del reclamo che l ordine non ha', { ordini: [o()], resi: [], reclami: [{ dispute_id: RECLAMO, order_id: ORDINE, fatto_at: null }], con162: true }, { centesimi: 0, incerti: 1 }],
    ['reso col bonifico che l ordine non ha', { ordini: [o()], resi: [reso({ refund_id: SEGNO_DEL_RESO, refund_bonifico_fatto_at: null })], reclami: [], con162: true }, { centesimi: 0, incerti: 1 }],
    ['reso aperto in contanti, senza scelta', { ordini: [o()], resi: [reso({ status: 'RECEIVED', refund_method: null })], reclami: [], con162: true }, { resiAperti: 1, incerti: 0 }],
    ['reso aperto in contanti, senza la 162', { ordini: [o()], resi: [reso({ status: 'REQUESTED' })], reclami: [], con162: false }, { resiAperti: 1, incerti: 0 }],
    ['reso aperto col credito scelto', { ordini: [o()], resi: [reso({ status: 'APPROVED', refund_method: 'CREDITO' })], reclami: [], con162: true }, nulla],
    ['reso aperto su un ordine pagato tutto col credito', { ordini: [o({ total_price: 0 })], resi: [reso({ status: 'APPROVED', refund_method: null })], reclami: [], con162: true }, nulla],
    ['reso aperto su un ordine con la carta', { ordini: [o({ payment_method: 'card', stripe_payment_intent: 'pi_1' })], resi: [reso({ status: 'APPROVED', refund_method: null })], reclami: [], con162: true }, nulla],
    ['reso e reclamo sull ordine di un altro', { ordini: [], resi: [reso({ refund_id: SEGNO_DEL_RESO })], reclami: [{ dispute_id: RECLAMO, order_id: ORDINE, fatto_at: null }], con162: true }, nulla],
  ])('%s', (_nome, dati, atteso) => {
    expect(iBonificiCheFannoAspettare(dati)).toMatchObject(atteso);
  });

  it('nessuna scelta vuol dire bonifico solo se l ordine e in contanti', () => {
    const aperto = { status: 'RECEIVED', refund_id: null, refund_method: null, refund_bonifico_fatto_at: null };
    expect(ilBonificoDelResoEAncoraDaFare(aperto, true)).toBe(true);
    expect(ilBonificoDelResoEAncoraDaFare(aperto, false)).toBe(false);
    expect(ilBonificoDelResoEAncoraDaFare({ ...aperto, refund_method: 'CREDITO' }, true)).toBe(false);
    expect(ilBonificoDelResoEAncoraDaFare({ ...aperto, status: 'REJECTED' }, true)).toBe(false);
  });

  it('quello che non si sa non ha un motivo: per la notte e un guasto', () => {
    expect(attesaPerIBonifici({ centesimi: 4000, incerti: 1, resiAperti: 0, con162: false })?.motivo).toBeUndefined();
    expect(attesaPerIBonifici({ centesimi: 4000, incerti: 0, resiAperti: 0, con162: true })?.motivo).toBe('bonifico_da_fare');
    expect(attesaPerIBonifici({ centesimi: 0, incerti: 0, resiAperti: 1, con162: true })?.motivo).toBe('bonifico_da_fare');
    expect(attesaPerIBonifici({ centesimi: 0, incerti: 0, resiAperti: 0, con162: true })).toBeNull();
  });
});

describe('con la 162: Giulia aspetta 40 € col bonifico', () => {
  it('l account resta finche il bonifico non risulta fatto, anche con l IBAN, e sui bonifici non si scrive niente', async () => {
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);

    expect(esito).toMatchObject({ ok: false, motivo: 'bonifico_da_fare' });
    expect(esito.errore).toMatch(/40,00\s€/u);
    expect(finto.cancellati, 'account cancellato con 40 € ancora da restituire').toEqual([]);
    expect(finto.db.tabelle.orders[0].delivery_full_name).toBe('Giulia Verdi');
    expect(finto.db.tabelle.returns[0]).toMatchObject({ refund_iban: IBAN, refund_intestatario: null });
    expect(finto.db.scritture.filter((s) => s.tabella === 'returns' || s.tabella === 'bonifici_dei_reclami')).toEqual([]);
  });

  it('segnato il bonifico fatto, la cancellazione va avanti', async () => {
    // Quello che fa «Bonifico fatto» nella lista: la data, e l'IBAN se ne va.
    Object.assign(finto.db.tabelle.returns[0], { refund_bonifico_fatto_at: '2026-10-16T09:00:00Z', refund_iban: null });
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(esito.ok, esito.errore).toBe(true);
    expect(finto.cancellati).toEqual([GIULIA]);
  });

  it('il giro notturno lo conta fra i rinvii, e a Giulia arriva il perche', async () => {
    const notte = laNotte(await cancellaAccount(finto.db.client as never, GIULIA));
    expect(notte).toMatchObject({ rinviate: 1, fallite: 0, daSvegliare: false });
    expect(notte.dovuti[0].corpo).toMatch(/ti dobbiamo ancora 40,00\s€ di rimborso con un bonifico/u);
  });

  it('dal pannello: 409, e la pagina mostra la frase intera, con la cifra', async () => {
    const r = await eliminaDalPannello(GIULIA);
    expect(r.status).toBe(409);
    expect(r.aVideo, 'la pagina sostituisce la frase col testo generico').toBe(r.messaggio);
    expect(r.aVideo).toMatch(/40,00\s€/u);
    expect(r.aVideo).toContain('Rimborsi da bonificare');
    expect(finto.cancellati).toEqual([]);
  });

  it('un reso aperto in contanti fa aspettare; chiuso senza rimborso, la cancellazione riparte', async () => {
    mondo({ orders: [ordine({ stripe_refund_id: null, payment_status: 'PAID' })], returns: [resoRimborsato({ status: 'APPROVED', refund_id: null, refund_method: null, refund_iban: null })] });
    const prima = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(prima).toMatchObject({ ok: false, motivo: 'bonifico_da_fare' });
    expect(prima.errore).toContain('reso ancora aperto');
    expect((await eliminaDalPannello(GIULIA)).aVideo).toContain('reso aperto');

    finto.db.tabelle.returns[0].status = 'REJECTED';
    const dopo = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(dopo.ok, dopo.errore).toBe(true);
  });
});

describe('senza la 162 (colonne del reso e tabella dei reclami assenti)', () => {
  beforeEach(() => mondo({ returns: [senzaLe162(resoRimborsato())] }, true));

  it('IL CASO DELLA SCHEDA — Giulia con 40 € da riavere non sparisce: la cancellazione si ferma', async () => {
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(esito.ok).toBe(false);
    expect(finto.cancellati, 'account cancellato con 40 € da bonificare, senza IBAN e ora senza nome').toEqual([]);
    expect(finto.db.tabelle.orders[0].delivery_full_name).toBe('Giulia Verdi');
    expect(esito.bonifici).toMatchObject({ con162: false, centesimi: 4000 });
  });

  it('non si sa se il bonifico e fatto: niente motivo, e la notte sveglia chi amministra', async () => {
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(esito.motivo).toBeUndefined();
    const notte = laNotte(esito);
    expect(notte).toMatchObject({ fallite: 1, daSvegliare: true });
    expect(notte.dovuti, 'a Giulia non si dice una cosa che non sappiamo').toEqual([]);
  });

  it('dal pannello: la frase dice il motivo vero, la 162, e la pagina la mostra intera', async () => {
    const r = await eliminaDalPannello(GIULIA);
    expect(r.status).toBe(409);
    expect(r.aVideo).toBe(r.messaggio);
    expect(r.aVideo).toContain('migrazione 162');
    expect(finto.cancellati).toEqual([]);
  });

  it('lo stesso per un reclamo: senza la tabella, il segno sull ordine basta a fermarla', async () => {
    mondo({ orders: [ordine({ stripe_refund_id: SEGNO_DEL_RECLAMO })], returns: [] }, true);
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(esito.ok).toBe(false);
    expect(finto.cancellati).toEqual([]);
  });

  it('controllo: senza bonifici e senza resi aperti, la 162 che manca non ferma nessuno', async () => {
    mondo({ orders: [ordine({ payment_method: 'card', stripe_payment_intent: 'pi_1', stripe_refund_id: 're_1' })], returns: [] }, true);
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(esito.ok, esito.errore).toBe(true);
  });
});

describe('il bonifico di un reclamo la cui riga non si e scritta', () => {
  beforeEach(() => mondo({ orders: [ordine({ stripe_refund_id: SEGNO_DEL_RECLAMO })], returns: [], disputes: [{ id: RECLAMO, order_id: ORDINE, opener_id: GIULIA }] }));

  it('IL CASO DELLA SCHEDA — il segno sta sull ordine, la riga no: la cancellazione si ferma e chi amministra lo legge', async () => {
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(esito.ok).toBe(false);
    expect(esito.motivo).toBeUndefined();
    expect(finto.cancellati).toEqual([]);

    const r = await eliminaDalPannello(GIULIA);
    expect(r.status).toBe(409);
    expect(r.aVideo).toBe(r.messaggio);
    expect(r.aVideo).toMatch(/non si sa se è stato fatto/u);
  });

  it('controllo: con la riga, aspetta col suo motivo; segnata fatta, va avanti', async () => {
    finto.db.tabelle.bonifici_dei_reclami.push({ dispute_id: RECLAMO, order_id: ORDINE, importo_cents: 2400, fatto_at: null, iban: null, intestatario: null });
    expect(await cancellaAccount(finto.db.client as never, GIULIA)).toMatchObject({ ok: false, motivo: 'bonifico_da_fare' });

    finto.db.tabelle.bonifici_dei_reclami[0].fatto_at = '2026-10-16T09:00:00Z';
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(esito.ok, esito.errore).toBe(true);
  });
});

describe('il bonifico e di chi ha comprato, non di chi ha aperto il reclamo', () => {
  // Il negozio apre un reclamo sull'ordine di Giulia (la 063 lo permette), chiuso a favore di lei.
  beforeEach(() =>
    mondo({
      orders: [ordine({ stripe_refund_id: SEGNO_DEL_RECLAMO })],
      returns: [],
      disputes: [{ id: RECLAMO, order_id: ORDINE, opener_id: NEGOZIO }],
      bonifici_dei_reclami: [{ dispute_id: RECLAMO, order_id: ORDINE, importo_cents: 2400, fatto_at: null, iban: null, intestatario: null }],
    }),
  );

  it('IL CASO DELLA SCHEDA — il negozio cancella l account: non aspetta il debito di Giulia, e sul bonifico non scrive il suo nome', async () => {
    const esito = await cancellaAccount(finto.db.client as never, NEGOZIO);
    expect(esito.motivo, `il negozio aspetta un bonifico che non e suo: ${esito.errore}`).toBeUndefined();
    expect(esito.ok, esito.errore).toBe(true);
    expect(finto.db.tabelle.bonifici_dei_reclami[0].intestatario, 'il nome del negozio sul bonifico della cliente').toBeNull();
  });

  it('IL CASO DELLA SCHEDA — Giulia cancella l account: il suo debito la fa aspettare', async () => {
    const esito = await cancellaAccount(finto.db.client as never, GIULIA);
    expect(esito).toMatchObject({ ok: false, motivo: 'bonifico_da_fare' });
    expect(esito.errore).toMatch(/24,00\s€/u);
    expect(finto.cancellati).toEqual([]);
  });
});

describe('le parole', () => {
  const casi: Array<[string, BonificiDaFare]> = [
    ['bonifico dovuto', { centesimi: 4000, incerti: 0, resiAperti: 0, con162: true }],
    ['bonifico grosso e reso aperto', { centesimi: 123456, incerti: 0, resiAperti: 2, con162: true }],
    ['solo reso aperto', { centesimi: 0, incerti: 0, resiAperti: 1, con162: false }],
    ['non si sa, con la 162', { centesimi: 123456, incerti: 3, resiAperti: 1, con162: true }],
    ['non si sa, senza la 162', { centesimi: 123456, incerti: 3, resiAperti: 1, con162: false }],
  ];

  it.each(casi)('a chi amministra arriva intera: %s', (_nome, b) => {
    const frase = rinvioPerChiAmministra(b);
    expect(frase.length).toBeLessThan(200);
    expect(friendlyError(new Error(frase)), 'la pagina la sostituisce col testo generico').toBe(frase);
  });

  it('alla persona non si promette che basti l IBAN: si riparte quando non ci sono piu bonifici da fare', () => {
    for (const b of [casi[0][1], casi[1][1], casi[2][1]]) {
      const frase = rinvioPerLaPersona(b);
      expect(frase).toMatch(/riparte da sola quando non ci saranno più bonifici da farti/u);
      expect(frase).not.toMatch(/quando avremo l.IBAN/u);
    }
    expect(SE_CANCELLI_L_ACCOUNT_CON_UN_BONIFICO_DA_FARE).toMatch(/la cancellazione aspetta che ogni bonifico che ti dobbiamo risulti fatto/u);
    expect(SE_CANCELLI_L_ACCOUNT_CON_UN_BONIFICO_DA_FARE).not.toMatch(/restano solo il tuo IBAN e il tuo nome/u);
    expect(QUANTO_TENIAMO_L_IBAN).not.toMatch(/intestatario/u);
  });
});
