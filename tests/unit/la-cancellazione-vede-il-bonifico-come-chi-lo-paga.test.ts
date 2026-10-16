import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { cancellaAccount } from '@/lib/account/cancellazione';
import { bonificiPrimaDiCancellare } from '@/lib/rimborsi/iban-del-rimborso';
import { bonificiDeiResiDagliOrdini, vociDeiBonificiDaFare, type RigaDelResoLetta } from '@/lib/rimborsi/bonifici-da-fare';
import { quantoSiPuoRestituire, ripartoDelRimborso } from '@/lib/rimborsi/regole-del-rimborso';

/**
 * Riesame del 16/10, quinto giro — LA CANCELLAZIONE DELL'ACCOUNT VEDE IL BONIFICO COME LO VEDE CHI PAGA.
 *
 * Prima di cancellare un account, la custodia dei bonifici (oggi `bonificiPrimaDiCancellare`) decideva quali bonifici di rimborso erano
 * ancora da fare: li tiene (IBAN e nome) o, se manca l'IBAN, fa aspettare la cancellazione. Rispondeva
 * alla domanda «c'e' un bonifico da fare?» con regole sue, diverse da quelle di chi muove i soldi e
 * della lista di chi paga:
 *
 *  ① il segno del bonifico stava solo sull'ordine (la scrittura sul reso era caduta): la lista lo
 *    mostrava, 40 € da pagare; la custodia guardava solo il reso e diceva «niente da pagare» —
 *    cancellava l'IBAN, non scriveva il nome e lasciava andare l'account. In lista restavano 40 €
 *    senza conto, senza nome e senza piu' l'email per chiederli;
 *  ② lo stesso su un reso ancora APPROVED: lo contava fra i resi aperti, senza la cifra;
 *  ③ un ordine «in contanti» coperto tutto dal credito MyCity: chi muove i soldi lo rimborsa in
 *    credito, la custodia aspettava un IBAN per un bonifico che non ci sara' mai;
 *  ④ col rinvio scriveva comunque il nome dell'intestatario, e la lista lo mostrava come quello di
 *    un cliente che se n'era andato, mentre l'account c'era ancora.
 *
 * Riesame del 16/10, sesto giro — la regola e' una sola: finche' un bonifico e' da fare la
 * cancellazione aspetta, con l'IBAN o senza, e qui non si scrive niente (niente nome sulla voce).
 *
 * Gira la cancellazione vera su un finto database che applica i filtri di letture e scritture.
 */

const MARIA = 'maria';
const IBAN = 'IT60X0542811101000000123456';
const SEGNO = 'bonifico:4000:return_r1';

let db: FintoDatabase;
let accountCancellato: boolean;

function ordine(extra: Riga = {}): Riga {
  return {
    id: 'o1', user_id: MARIA, delivery_full_name: 'Maria Rossi', payment_method: 'cod', stripe_payment_intent: null,
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0, delivery_status: 'DELIVERED',
    payment_status: 'REFUNDED', stripe_refund_id: SEGNO, ...extra,
  };
}

function reso(extra: Riga = {}): Riga {
  return {
    id: 'r1', order_id: 'o1', buyer_id: MARIA, status: 'REFUNDED', refund_id: null, refund_method: 'BONIFICO',
    refund_iban: IBAN, refund_intestatario: null, refund_bonifico_cents: null, refund_bonifico_fatto_at: null,
    refund_amount_cents: 4000, refunded_at: '2026-10-15T10:00:00Z', ...extra,
  };
}

function mondo(o: Riga, resi: Riga[]) {
  db = creaFintoDatabase({
    cod_reconciliations: [],
    orders: [o],
    returns: resi,
    disputes: [],
    bonifici_dei_reclami: [],
    profiles: [{ id: MARIA, full_name: 'Maria Rossi' }],
  });
  accountCancellato = false;
  const auth = db.client.auth.admin as unknown as Record<string, unknown>;
  auth.deleteUser = async () => {
    accountCancellato = true;
    return { error: null };
  };
}

/** La lista di chi paga, costruita come la costruisce la rotta (lib/rimborsi/bonifici-da-fare.ts). */
function laLista() {
  const ordini = db.tabelle.orders.map((o) => ({ id: String(o.id), stripe_refund_id: o.stripe_refund_id as string | null }));
  return vociDeiBonificiDaFare(bonificiDeiResiDagliOrdini(ordini, db.tabelle.returns as unknown as RigaDelResoLetta[]));
}

beforeEach(() => mondo(ordine(), [reso()]));

describe('① il bonifico rimasto solo sull ordine: la cancellazione lo vede, come la lista', () => {
  it('IL CASO CHE ROMPEVA — con l IBAN: la cancellazione aspetta il bonifico, e l IBAN resta dov e', async () => {
    expect(laLista(), 'la lista non vede il bonifico: la prova non misura niente').toHaveLength(1);

    const esito = await cancellaAccount(db.client as never, MARIA);

    expect(esito).toMatchObject({ ok: false, motivo: 'bonifico_da_fare' });
    expect(accountCancellato, 'l account e sparito con 40 € da pagare').toBe(false);
    expect(db.tabelle.returns[0].refund_iban, 'IBAN cancellato mentre il bonifico e ancora da fare').toBe(IBAN);
    const [voce] = laLista();
    expect(voce).toMatchObject({ importoCents: 4000, daFare: true });
    expect(voce.iban?.replace(/\s/g, '')).toBe(IBAN);
  });

  it('senza IBAN: la cancellazione aspetta, con la cifra, e l account resta', async () => {
    mondo(ordine(), [reso({ refund_iban: null })]);
    const esito = await cancellaAccount(db.client as never, MARIA);
    expect(esito).toMatchObject({ ok: false, motivo: 'bonifico_da_fare' });
    expect(esito.errore).toMatch(/40,00\s€/u);
    expect(accountCancellato, 'l account e sparito con 40 € da pagare e nessun conto').toBe(false);
  });

  it('controllo: col segno anche sul reso la risposta e la stessa; fatto il bonifico, va avanti', async () => {
    mondo(ordine(), [reso({ refund_id: SEGNO, refund_bonifico_cents: 4000 })]);
    expect(await cancellaAccount(db.client as never, MARIA)).toMatchObject({ ok: false, motivo: 'bonifico_da_fare' });
    Object.assign(db.tabelle.returns[0], { refund_bonifico_fatto_at: '2026-10-16T09:00:00Z', refund_iban: null });
    const esito = await cancellaAccount(db.client as never, MARIA);
    expect(esito.ok, esito.errore).toBe(true);
    expect(accountCancellato).toBe(true);
  });
});

describe('② un reso APPROVED col rimborso gia partito e registrato sull ordine', () => {
  it('conta fra i bonifici dovuti, con la sua cifra: non fra i resi aperti', async () => {
    mondo(ordine(), [reso({ status: 'APPROVED', refund_iban: null })]);
    const letti = await bonificiPrimaDiCancellare(db.client, MARIA);
    if (!letti.ok) throw new Error(letti.errore);
    expect(letti.bonifici).toMatchObject({ centesimi: 4000, incerti: 0, resiAperti: 0 });
  });
});

describe('③ un ordine «in contanti» pagato tutto col credito MyCity non aspetta nessun IBAN', () => {
  const tuttoCredito = () =>
    ordine({ total_price: 0, gross_total_cents: 2000, wallet_applied_cents: 2000, payment_status: 'PAID', stripe_refund_id: null });

  it('IL CASO CHE ROMPEVA — reso aperto senza scelta: la cancellazione va avanti', async () => {
    mondo(tuttoCredito(), [reso({ status: 'APPROVED', refund_method: null, refund_iban: null })]);
    // Chi muove i soldi, sullo stesso ordine, non fara' mai un bonifico.
    const o = db.tabelle.orders[0];
    const residuo = quantoSiPuoRestituire(o);
    expect(residuo.massimoCents).toBe(2000);
    expect(ripartoDelRimborso(o, residuo.massimoCents, null)).toMatchObject({ modo: 'credito', bonificoCents: 0 });

    const esito = await cancellaAccount(db.client as never, MARIA);
    expect(esito.motivo, `aspetta un IBAN per un bonifico che non ci sara: ${esito.errore}`).toBeUndefined();
    expect(esito.ok).toBe(true);
    expect(db.tabelle.returns[0].refund_intestatario ?? null, 'nome scritto per un bonifico che non ci sara').toBeNull();
  });

  it('controllo: con una parte in contanti lo stesso reso aspetta', async () => {
    mondo(ordine({ stripe_refund_id: null, payment_status: 'PAID' }), [reso({ status: 'APPROVED', refund_method: null, refund_iban: null })]);
    const esito = await cancellaAccount(db.client as never, MARIA);
    expect(esito).toMatchObject({ ok: false, motivo: 'bonifico_da_fare' });
  });
});

describe('④ se la cancellazione aspetta, sui bonifici non si scrive niente', () => {
  it('IL CASO CHE ROMPEVA — reclamo senza IBAN: rinviata, e la voce non porta il nome di uno che se n e andato', async () => {
    mondo(ordine({ stripe_refund_id: 'bonifico:2400:dispute_d1' }), []);
    db.tabelle.disputes.push({ id: 'd1', order_id: 'o1', opener_id: MARIA });
    db.tabelle.bonifici_dei_reclami.push({ dispute_id: 'd1', order_id: 'o1', importo_cents: 2400, fatto_at: null, iban: null, intestatario: null });

    const esito = await cancellaAccount(db.client as never, MARIA);

    expect(esito).toMatchObject({ ok: false, motivo: 'bonifico_da_fare' });
    expect(db.tabelle.profiles, 'l account non c e piu: la prova non misura il caso').toHaveLength(1);
    expect(db.tabelle.bonifici_dei_reclami[0].intestatario, 'nome scritto come se il cliente se ne fosse andato').toBeNull();
  });

  it('anche il bonifico che l IBAN ce l ha, se un altro lo fa aspettare', async () => {
    mondo(ordine({ stripe_refund_id: `${SEGNO},bonifico:2400:dispute_d1` }), [reso({ refund_id: SEGNO, refund_bonifico_cents: 4000 })]);
    db.tabelle.disputes.push({ id: 'd1', order_id: 'o1', opener_id: MARIA });
    db.tabelle.bonifici_dei_reclami.push({ dispute_id: 'd1', order_id: 'o1', importo_cents: 2400, fatto_at: null, iban: null, intestatario: null });

    const esito = await cancellaAccount(db.client as never, MARIA);

    expect(esito.motivo).toBe('bonifico_da_fare');
    expect(db.tabelle.returns[0].refund_intestatario ?? null).toBeNull();
    expect(db.tabelle.returns[0].refund_iban, 'l IBAN di chi aspetta un bonifico non si tocca').toBe(IBAN);
  });
});
