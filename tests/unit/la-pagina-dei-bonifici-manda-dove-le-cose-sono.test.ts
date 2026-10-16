/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, ordineCheCade: false }));

vi.mock('@/lib/supabase/server', () => {
  const client = () => {
    const c = finto.db.client;
    return {
      ...c,
      from: (tabella: string) => {
        const q = c.from(tabella) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (tabella !== 'orders' || !finto.ordineCheCade) return q;
        const update = q.update.bind(q);
        // Il guasto: la scrittura del rimborso nell'elenco dell'ordine (stripe_refund_id) va in
        // timeout. Dal quinto giro quell'elenco si scrive da solo, con una scrittura condizionata
        // (aggiungiAllElencoDeiRimborsi in lib/stripe/payout.ts), prima dello stato del pagamento:
        // il guasto va messo li', o la prova non misura piu' il caso.
        q.update = (valori: unknown) => {
          if (valori && typeof valori === 'object' && 'stripe_refund_id' in valori) {
            const caduta: Record<string, unknown> = {};
            caduta.eq = () => caduta;
            caduta.is = () => caduta;
            caduta.select = () => caduta;
            caduta.then = (ok: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }).then(ok);
            return caduta;
          }
          return update(valori);
        };
        return q;
      },
    };
  };
  return { getAdminSupabase: () => client(), getServerSupabase: async () => client() };
});
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({ refunds: { create: vi.fn(async () => ({ id: 're_1' })) }, transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) } }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { cancellaAccount } from '@/lib/account/cancellazione';
import { refundOrder } from '@/lib/stripe/payout';
import { vociDeiBonificiDaFare, type RigaDelBonificoDelReclamo } from '@/lib/rimborsi/bonifici-da-fare';
import { PAGINA_DEI_BONIFICI_DA_FARE } from '@/lib/rimborsi/scelta-del-reso';

/**
 * Riesame del 16/10, quinto giro — DUE COSE CHE LA PAGINA DEI BONIFICI DICEVA SENZA CHE FOSSERO VERE.
 *
 *  ① Accanto al nome dell'intestatario: «il cliente ha chiuso l'account». La cancellazione scriveva
 *    il nome e poi, se mancava l'IBAN, si fermava: l'account restava, e chi paga leggeva che il
 *    cliente se n'era andato. Adesso col rinvio non si scrive niente, e la frase dice solo quando il
 *    nome e' arrivato li' — vero anche se la cancellazione cade a meta' per un guasto.
 *  ② Sui bonifici da controllare: «apri l'ordine e cerca l'avviso». L'avviso non sta nell'ordine:
 *    sta fra le notifiche di chi amministra. Al quinto giro la frase mandava alle Notifiche; al
 *    sesto il riesame ha mostrato che nemmeno li' basta (le Notifiche mostrano le ultime 50, e
 *    l'avviso a volte non si scrive), e il riquadro «da controllare» non c'e' piu': quando il
 *    segno sull'ordine non si scrive, e' il server a dirlo a chi amministra, con un avviso apposta.
 *
 * Girano la cancellazione vera e la `refundOrder` vera su un finto database; la pagina e' quella
 * vera, montata, letta come la legge chi paga.
 */

const globale = globalThis as Record<string, unknown>;
const MARCO = 'marco';
const ORDINE = 'aaaabbbb-0000-4000-8000-000000000001';
const IBAN = 'IT60X0542811101000000123456';

let Banco: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  Banco = (await monta('tests/unit/aiuti/banco-dei-bonifici-da-fare.tsx')).default as ComponentType<Record<string, unknown>>;
}, 120000);

let accountCancellato: boolean;
function mondoDiMarco(deleteUserCade = false) {
  finto.db = creaFintoDatabase({
    cod_reconciliations: [],
    orders: [{ id: ORDINE, user_id: MARCO, delivery_full_name: 'Marco Bianchi', payment_method: 'cod', stripe_payment_intent: null, total_price: 24 }],
    returns: [],
    disputes: [{ id: 'd1', order_id: ORDINE, opener_id: MARCO }],
    bonifici_dei_reclami: [],
    profiles: [{ id: MARCO, full_name: 'Marco Bianchi' }],
  });
  accountCancellato = false;
  const auth = finto.db.client.auth.admin as unknown as Record<string, unknown>;
  auth.deleteUser = async () => {
    if (deleteUserCade) return { error: { message: 'Auth non risponde' } };
    accountCancellato = true;
    return { error: null };
  };
}

function laPaginaDice(dati: Record<string, unknown>) {
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = dati;
  const s = accendi(Banco);
  const testo = testoVisibile(s.radice);
  return { s, testo };
}

beforeEach(() => {
  finto.ordineCheCade = false;
});
afterEach(() => {
  delete globale.__MUTAZIONI__;
  delete globale.__DATI_QUERY__;
});

describe('① la pagina non dice che il cliente se n e andato quando l account c e ancora', () => {
  it('IL CASO CHE ROMPEVA — reclamo da 24 € senza IBAN: la cancellazione aspetta, e la voce non ha il nome', async () => {
    mondoDiMarco();
    finto.db.tabelle.bonifici_dei_reclami.push({
      dispute_id: 'd1', order_id: ORDINE, importo_cents: 2400, registrato_at: '2026-10-15T10:00:00Z', fatto_at: null, iban: null, intestatario: null,
    });

    const esito = await cancellaAccount(finto.db.client as never, MARCO);
    expect(esito.motivo, 'la cancellazione non si e fermata: la prova non misura il caso').toBe('bonifico_senza_iban');
    expect(accountCancellato).toBe(false);

    const voci = vociDeiBonificiDaFare([], finto.db.tabelle.bonifici_dei_reclami as unknown as RigaDelBonificoDelReclamo[]);
    const { s, testo } = laPaginaDice({ voci, migrazione162: true });
    expect(testo, 'la voce non e comparsa').toMatch(/24,00/u);
    expect(testo, 'la pagina mostra il nome come se il cliente se ne fosse andato').not.toContain('Intestatario');
    expect(testo).not.toMatch(/chiuso l.account/u);
    s.smonta();
  }, 60000);

  it('la cancellazione cade a meta per un guasto: il nome c e, e la frase accanto e vera lo stesso', async () => {
    mondoDiMarco(true);
    finto.db.tabelle.bonifici_dei_reclami.push({
      dispute_id: 'd1', order_id: ORDINE, importo_cents: 2400, registrato_at: '2026-10-15T10:00:00Z', fatto_at: null, iban: IBAN, intestatario: null,
    });

    const esito = await cancellaAccount(finto.db.client as never, MARCO);
    expect(esito.ok).toBe(false);
    expect(accountCancellato).toBe(false);
    expect(finto.db.tabelle.profiles, 'l account non c e piu: la prova non misura il caso').toHaveLength(1);

    const voci = vociDeiBonificiDaFare([], finto.db.tabelle.bonifici_dei_reclami as unknown as RigaDelBonificoDelReclamo[]);
    const { s, testo } = laPaginaDice({ voci, migrazione162: true });
    expect(testo).toContain('Intestatario: Marco Bianchi');
    expect(testo, 'la pagina dice che il cliente ha chiuso l account, ma l account c e').not.toMatch(/chiuso l.account/u);
    s.smonta();
  }, 60000);
});

describe('② il segno sull ordine non si scrive: lo dice il server, non la lista', () => {
  function ordineInContanti(): Riga {
    return {
      id: ORDINE, user_id: MARCO, seller_id: 'negozio', total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
      seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
      stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
      refunded_amount_cents: 0, payment_method: 'cod', rider_id: null, rider_transfer_id: null, rider_payout_status: null,
      rider_payout_reversed_cents: 0, rider_fee_cents: 0, shipping_cost: 0, delivery_status: 'DELIVERED',
      payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z',
    };
  }
  async function rimborsa(chiave: string) {
    finto.db = creaFintoDatabase({
      orders: [ordineInContanti()],
      profiles: [{ id: 'nicola', role: 'admin' }],
      notifications: [],
      wallet_ledger: [],
    });
    return refundOrder({
      orderId: ORDINE, amountCents: 4000, reason: 'reso', idempotencyKey: chiave, notifyBuyer: false,
      contanti: { modo: 'BONIFICO', ibanFinale: '3456', doveSiPaga: PAGINA_DEI_BONIFICI_DA_FARE },
    });
  }

  it('IL CASO CHE ROMPEVA — rimborso vero da 40 €, segno sull ordine caduto: l avviso dice che in lista non c e', async () => {
    finto.ordineCheCade = true;
    const esito = await rimborsa('return_r1');
    expect(esito.refundId).toBe('bonifico:4000:return_r1');
    expect(finto.db.tabelle.orders[0].stripe_refund_id, 'il guasto non e avvenuto: la prova non misura il caso').toBeNull();

    expect(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare'), 'l avviso di sempre manda a una lista dove il bonifico non c e').toHaveLength(0);
    const [avviso] = notificheConTitolo(finto.db, 'fuori dalla lista');
    expect(avviso, 'chi amministra non sa che c e un bonifico da fare').toBeTruthy();
    const testo = String(avviso.body);
    expect(testo).toMatch(/40,00\s€/u);
    expect(testo).toContain('#aaaabbbb');
    expect(testo).toContain('3456');
    expect(testo, 'l avviso dice di non pagare un rimborso dovuto').not.toMatch(/non pagar/u);
    expect(avviso.link, 'l avviso manda alla lista, dove il bonifico non c e').not.toBe(PAGINA_DEI_BONIFICI_DA_FARE);
  }, 60000);

  it('controllo: col segno scritto parte l avviso di sempre, che manda alla lista', async () => {
    const esito = await rimborsa('return_r1');
    expect(String(finto.db.tabelle.orders[0].stripe_refund_id)).toContain(esito.refundId);
    expect(notificheConTitolo(finto.db, 'fuori dalla lista')).toHaveLength(0);
    const [avviso] = notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
    expect(avviso.link).toBe(PAGINA_DEI_BONIFICI_DA_FARE);
  }, 60000);

  it('un reclamo col segno caduto ha la sua riga a parte: l avviso resta quello di sempre', async () => {
    finto.ordineCheCade = true;
    await rimborsa('dispute_d1');
    expect(notificheConTitolo(finto.db, 'fuori dalla lista')).toHaveLength(0);
    expect(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare')).toHaveLength(1);
  }, 60000);
});
