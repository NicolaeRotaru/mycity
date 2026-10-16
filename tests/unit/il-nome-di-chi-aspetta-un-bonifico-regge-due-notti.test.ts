import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { custodisciIBonificiDaFare, ilBonificoDelResoEAncoraDaFare } from '@/lib/rimborsi/iban-del-rimborso';

/**
 * Riesame del 16/10, terzo giro — IL NOME A CUI INTESTARE IL BONIFICO, PRIMA DI CANCELLARE UN ACCOUNT.
 *
 * Prima di cancellare l'account di chi aspetta ancora un bonifico di rimborso, la cancellazione
 * scrive sul reso (o sul bonifico del reclamo) il nome dell'intestatario: subito dopo, la pulizia
 * toglie il nome dagli ordini, e senza un nome il bonifico non si fa. Due buchi:
 *
 *  ① DUE NOTTI. Se un passo dopo la pulizia degli ordini cade (Stripe che non risponde, una
 *    tabella che non si ripulisce), la cancellazione si riprova la notte dopo — e ripartiva da
 *    capo: il nome sull'ordine era ormai vuoto, e la seconda notte scriveva «niente» sopra
 *    «Maria Rossi». Con un nome diverso sul profilo, scriveva quello.
 *  ② NESSUNA SCELTA = BONIFICO. Un reso aperto senza la scelta salvata (aperto prima della 162, o
 *    da un modulo che non la manda) su un ordine in contanti va col bonifico, per la 162 e per
 *    `comeTornanoIContanti`. Ma qui contava solo «BONIFICO» scritto: il nome non si salvava, e a
 *    rimborso fatto in lista restava «40 € da fare» senza nessuno a cui farli.
 *
 * Gira la funzione vera, su un finto database che applica davvero i filtri delle scritture.
 */

const MARIA = 'maria';
const IBAN = 'IT60X0542811101000000123456';

function ordine(id: string, extra: Riga = {}): Riga {
  // Quinto giro del riesame: con la sua cassa in contanti (senza, era coperto tutto dal credito).
  return { id, user_id: MARIA, delivery_full_name: 'Maria Rossi', payment_method: 'cod', stripe_payment_intent: null, total_price: 30, ...extra };
}

let db: FintoDatabase;

beforeEach(() => {
  db = creaFintoDatabase({
    orders: [ordine('o1')],
    returns: [],
    disputes: [],
    bonifici_dei_reclami: [],
    profiles: [{ id: MARIA, full_name: null }],
  });
});

/** La pulizia della cancellazione toglie il nome dagli ordini (lib/account/cancellazione.ts). */
function laPuliziaTogliIlNomeDagliOrdini() {
  for (const o of db.tabelle.orders) o.delivery_full_name = null;
}

const reso = () => db.tabelle.returns[0];

describe('① la cancellazione ripresa la notte dopo non cancella il nome gia messo al sicuro', () => {
  it('IL CASO CHE ROMPEVA — Maria, profilo senza nome: la seconda notte il nome resta', async () => {
    db.tabelle.returns.push({
      id: 'r1', order_id: 'o1', buyer_id: MARIA, status: 'REFUNDED', refund_id: 'bonifico:3000:return_r1',
      refund_method: 'BONIFICO', refund_iban: IBAN, refund_bonifico_fatto_at: null, refund_intestatario: null,
    });

    expect((await custodisciIBonificiDaFare(db.client, MARIA)).ok).toBe(true);
    expect(reso().refund_intestatario, 'la prima notte il nome non e stato messo al sicuro').toBe('Maria Rossi');

    laPuliziaTogliIlNomeDagliOrdini();
    // Un passo dopo cade: la cancellazione si riprova la notte dopo, da capo.
    expect((await custodisciIBonificiDaFare(db.client, MARIA)).ok).toBe(true);

    expect(reso().refund_intestatario, 'la seconda notte ha cancellato il nome a cui intestare 30 €').toBe('Maria Rossi');
    expect(reso().refund_iban).toBe(IBAN);
  });

  it('con un nome diverso sul profilo, la seconda notte non lo scrive sopra quello dell ordine', async () => {
    db.tabelle.profiles[0].full_name = 'Mary';
    db.tabelle.returns.push({
      id: 'r1', order_id: 'o1', buyer_id: MARIA, status: 'REFUNDED', refund_id: 'bonifico:3000:return_r1',
      refund_method: 'BONIFICO', refund_iban: IBAN, refund_bonifico_fatto_at: null, refund_intestatario: null,
    });

    await custodisciIBonificiDaFare(db.client, MARIA);
    laPuliziaTogliIlNomeDagliOrdini();
    await custodisciIBonificiDaFare(db.client, MARIA);

    expect(reso().refund_intestatario).toBe('Maria Rossi');
  });

  it('lo stesso per il bonifico di un reclamo', async () => {
    db.tabelle.disputes.push({ id: 'd1', order_id: 'o1', opener_id: MARIA });
    // Con l'IBAN gia' copiato sulla voce: senza, la cancellazione aspetta e non scrive niente
    // (chi-aspetta-un-bonifico-senza-iban-non-sparisce.test.ts).
    db.tabelle.bonifici_dei_reclami.push({
      dispute_id: 'd1', order_id: 'o1', importo_cents: 2400, fatto_at: null, iban: IBAN, intestatario: null,
    });

    await custodisciIBonificiDaFare(db.client, MARIA);
    expect(db.tabelle.bonifici_dei_reclami[0].intestatario).toBe('Maria Rossi');
    laPuliziaTogliIlNomeDagliOrdini();
    await custodisciIBonificiDaFare(db.client, MARIA);

    expect(db.tabelle.bonifici_dei_reclami[0].intestatario, 'la seconda notte ha cancellato il nome del reclamo').toBe('Maria Rossi');
  });
});

describe('② un reso aperto senza scelta, su un ordine in contanti, conta come bonifico da fare', () => {
  it('IL CASO CHE ROMPEVA — Giulia apre il reso prima della 162 e cancella l account: il nome non si perde', async () => {
    db.tabelle.orders[0].delivery_full_name = 'Giulia Rossi';
    db.tabelle.returns.push({
      id: 'r1', order_id: 'o1', buyer_id: MARIA, status: 'REQUESTED', refund_id: null,
      refund_method: null, refund_iban: null, refund_bonifico_fatto_at: null, refund_intestatario: null,
    });

    const custodia = await custodisciIBonificiDaFare(db.client, MARIA);
    if (!custodia.ok) throw new Error(custodia.errore);
    // Quinto giro del riesame: senza IBAN la cancellazione aspetta (il reso conta come bonifico da
    // fare), e finche' aspetta l'account resta e il nome sta sull'ordine: qui non si scrive niente.
    expect(custodia.senzaIban.resiInCorso, 'il reso senza scelta non conta come bonifico da fare').toBe(1);
    expect(db.tabelle.orders[0].delivery_full_name).toBe('Giulia Rossi');
    expect(reso().refund_intestatario ?? null).toBeNull();
  });

  it('con l IBAN la cancellazione va avanti, e il nome va sul reso', async () => {
    db.tabelle.orders[0].delivery_full_name = 'Giulia Rossi';
    db.tabelle.returns.push({
      id: 'r1', order_id: 'o1', buyer_id: MARIA, status: 'REQUESTED', refund_id: null,
      refund_method: null, refund_iban: IBAN, refund_bonifico_fatto_at: null, refund_intestatario: null,
    });

    expect((await custodisciIBonificiDaFare(db.client, MARIA)).ok).toBe(true);
    expect(reso().refund_intestatario, 'a rimborso fatto, in lista resta un bonifico senza nessuno a cui farlo').toBe('Giulia Rossi');
  });

  it('la regola: nessuna scelta vuol dire bonifico solo se l ordine e in contanti', () => {
    const aperto = { status: 'RECEIVED', refund_id: null, refund_method: null, refund_bonifico_fatto_at: null };
    expect(ilBonificoDelResoEAncoraDaFare(aperto, true)).toBe(true);
    expect(ilBonificoDelResoEAncoraDaFare(aperto, false)).toBe(false);
    expect(ilBonificoDelResoEAncoraDaFare({ ...aperto, refund_method: 'CREDITO' }, true)).toBe(false);
    expect(ilBonificoDelResoEAncoraDaFare({ ...aperto, status: 'REJECTED' }, true)).toBe(false);
  });

  it('su un ordine pagato con la carta non si scrive nessun nome', async () => {
    db.tabelle.orders[0].payment_method = 'card';
    db.tabelle.orders[0].stripe_payment_intent = 'pi_1';
    db.tabelle.returns.push({
      id: 'r1', order_id: 'o1', buyer_id: MARIA, status: 'REQUESTED', refund_id: null,
      refund_method: null, refund_iban: null, refund_bonifico_fatto_at: null, refund_intestatario: null,
    });

    await custodisciIBonificiDaFare(db.client, MARIA);
    expect(reso().refund_intestatario ?? null).toBeNull();
  });
});
