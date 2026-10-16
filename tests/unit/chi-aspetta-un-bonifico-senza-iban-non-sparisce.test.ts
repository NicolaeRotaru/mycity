import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { cancellaAccount } from '@/lib/account/cancellazione';
import { verdettoDelGiro } from '@/lib/cron-cancellazioni';
import { custodisciIBonificiDaFare, rinvioPerIBonificiSenzaIban } from '@/lib/rimborsi/iban-del-rimborso';

/**
 * Riesame del 16/10, quarto giro — SE IL CLIENTE CANCELLA L'ACCOUNT PRIMA DEL BONIFICO, NESSUNO SA
 * PIU' A CHI PAGARLO.
 *
 * Nicola chiude a favore di Marco un reclamo da 24 € su un ordine pagato in contanti: il rimborso
 * va col bonifico, e il modulo del reclamo non chiede l'IBAN — glielo chiediamo per email. Intanto
 * Marco chiede di cancellare l'account. Prima la cancellazione metteva al sicuro il nome (e l'IBAN,
 * se c'era) e andava avanti: con l'account se ne andava l'email, l'unico modo di chiedergli il
 * conto. A chi paga restava «24 € da fare, intestati a Marco Bianchi», e nessun IBAN.
 *
 * Adesso un bonifico da fare senza IBAN ferma la cancellazione con un motivo suo — un rinvio
 * deciso da noi, come per la cassa del fattorino — e Marco legge perche e cosa mandarci.
 *
 * Gira la cancellazione vera fino al punto in cui si ferma, su un finto database che applica i
 * filtri delle letture e delle scritture.
 */

const MARCO = 'marco';
const IBAN = 'IT60X0542811101000000123456';

let db: FintoDatabase;
let accountCancellato: boolean;

function mondo(extra: Record<string, Riga[]> = {}) {
  db = creaFintoDatabase({
    cod_reconciliations: [],
    orders: [{ id: 'o1', user_id: MARCO, delivery_full_name: 'Marco Bianchi', payment_method: 'cod', stripe_payment_intent: null }],
    returns: [],
    disputes: [],
    bonifici_dei_reclami: [],
    profiles: [{ id: MARCO, full_name: 'Marco Bianchi' }],
    ...extra,
  });
  accountCancellato = false;
  const auth = db.client.auth.admin as unknown as Record<string, unknown>;
  auth.deleteUser = async () => {
    accountCancellato = true;
    return { error: null };
  };
}

beforeEach(() => mondo());

describe('un bonifico da fare senza IBAN ferma la cancellazione', () => {
  it('IL CASO DELLA SCHEDA — reclamo da 24 € senza IBAN: rinviata, e Marco legge perche', async () => {
    db.tabelle.disputes.push({ id: 'd1', order_id: 'o1', opener_id: MARCO });
    db.tabelle.bonifici_dei_reclami.push({ dispute_id: 'd1', order_id: 'o1', importo_cents: 2400, fatto_at: null, iban: null, intestatario: null });

    const esito = await cancellaAccount(db.client as never, MARCO);

    expect(accountCancellato, 'l account e sparito con un bonifico da 24 € e nessun IBAN per pagarlo').toBe(false);
    expect(esito.ok).toBe(false);
    expect(esito.motivo).toBe('bonifico_senza_iban');
    expect(esito.errore).toMatch(/24,00\s€/u);
    expect(esito.errore).toContain('non abbiamo il tuo IBAN');
    expect(esito.errore).toContain('pagina Contatti');
    // Niente pulizia: i contatti sull'ordine restano finche la cancellazione non riparte.
    expect(db.tabelle.orders[0].delivery_full_name).toBe('Marco Bianchi');
  });

  it('il giro della notte lo conta fra i rinvii, non fra i guasti, e a Marco arriva la spiegazione', async () => {
    db.tabelle.disputes.push({ id: 'd1', order_id: 'o1', opener_id: MARCO });
    db.tabelle.bonifici_dei_reclami.push({ dispute_id: 'd1', order_id: 'o1', importo_cents: 2400, fatto_at: null, iban: null, intestatario: null });
    const esito = await cancellaAccount(db.client as never, MARCO);

    const verdetto = verdettoDelGiro(
      [{ userId: MARCO, ok: esito.ok, motivo: esito.motivo, errore: esito.errore, chiestaIl: new Date().toISOString() }],
      Date.now(),
      'privacy@example.it',
    );
    expect(verdetto).toMatchObject({ rinviate: 1, fallite: 0, daSvegliare: false });
    expect(verdetto.dovuti).toHaveLength(1);
    expect(verdetto.dovuti[0].corpo).toContain('non abbiamo il tuo IBAN');
  });

  it('reso rimborsato col bonifico ma senza IBAN: rinviata, con la cifra del bonifico', async () => {
    db.tabelle.returns.push({
      id: 'r1', order_id: 'o1', buyer_id: MARCO, status: 'REFUNDED', refund_id: 'bonifico:3000:return_r1',
      refund_method: null, refund_iban: null, refund_bonifico_cents: 3000, refund_bonifico_fatto_at: null,
    });
    const esito = await cancellaAccount(db.client as never, MARCO);
    expect(esito).toMatchObject({ ok: false, motivo: 'bonifico_senza_iban' });
    expect(esito.errore).toMatch(/30,00\s€/u);
    expect(accountCancellato).toBe(false);
  });

  it('reso ancora aperto su un ordine in contanti, senza IBAN: aspetta, e lo dice', async () => {
    db.tabelle.returns.push({
      id: 'r1', order_id: 'o1', buyer_id: MARCO, status: 'APPROVED', refund_id: null,
      refund_method: null, refund_iban: null, refund_bonifico_fatto_at: null,
    });
    const esito = await cancellaAccount(db.client as never, MARCO);
    expect(esito).toMatchObject({ ok: false, motivo: 'bonifico_senza_iban' });
    expect(esito.errore).toContain('reso ancora aperto');
  });
});

describe('quando l IBAN c e, o non c e niente da pagare, la cancellazione non aspetta', () => {
  it('l IBAN copiato sulla voce del reclamo: nessun bonifico senza IBAN, e il nome resta al sicuro', async () => {
    db.tabelle.disputes.push({ id: 'd1', order_id: 'o1', opener_id: MARCO });
    db.tabelle.bonifici_dei_reclami.push({ dispute_id: 'd1', order_id: 'o1', importo_cents: 2400, fatto_at: null, iban: IBAN, intestatario: null });
    const custodia = await custodisciIBonificiDaFare(db.client, MARCO);
    if (!custodia.ok) throw new Error(custodia.errore);
    expect(custodia.senzaIban).toMatchObject({ dovuti: 0, resiInCorso: 0 });
    expect(rinvioPerIBonificiSenzaIban(custodia.senzaIban)).toBeNull();
    expect(db.tabelle.bonifici_dei_reclami[0].intestatario).toBe('Marco Bianchi');
  });

  it('il bonifico gia fatto, o un reso col credito, non fermano niente', async () => {
    db.tabelle.disputes.push({ id: 'd1', order_id: 'o1', opener_id: MARCO });
    db.tabelle.bonifici_dei_reclami.push({ dispute_id: 'd1', order_id: 'o1', importo_cents: 2400, fatto_at: '2026-10-15T10:00:00Z', iban: null, intestatario: null });
    db.tabelle.returns.push({
      id: 'r1', order_id: 'o1', buyer_id: MARCO, status: 'REFUNDED', refund_id: 'wallet:return_r1',
      refund_method: 'CREDITO', refund_iban: null, refund_bonifico_fatto_at: null,
    });
    const custodia = await custodisciIBonificiDaFare(db.client, MARCO);
    if (!custodia.ok) throw new Error(custodia.errore);
    expect(rinvioPerIBonificiSenzaIban(custodia.senzaIban)).toBeNull();
  });
});
