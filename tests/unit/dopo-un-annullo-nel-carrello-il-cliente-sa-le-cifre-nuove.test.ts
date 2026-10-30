import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/10/2026 — consegna.negozio-che-rifiuta, quello che il cliente ne sa.
 *
 * Pane 15 € e frutta 12 €, consegna 4 €; il forno rifiuta. La consegna si rifà sulla frutta, che
 * passa da 13 € a 15 €, e al cliente tornano 16 € su 18. Prima né l'email di annullo né la
 * campanella lo dicevano: con i contanti il fattorino chiedeva 15 € dove la conferma diceva 13, con
 * la carta arrivava un rimborso di 16 € senza spiegazione. Qui si guarda il testo che parte davvero
 * (email e campanella), dalle strade vere: il rifiuto/annullo e il giro degli ordini scaduti.
 *
 * In fondo, due cose che stanno nello stesso giro di soldi: l'avviso agli amministratori quando il
 * rimborso non si può fare (deve dire che il carrello è già riscritto, con le cifre), e il database
 * di prima della migrazione 124 (il ricalcolo deve fare lo stesso conto senza `gross_total_cents`).
 */

const refundOrder = vi.fn(async (_a: { orderId: string; amountCents: number }) => ({ refundId: 're_1' }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { finto, carrello, tentativoDiCassa } from './carrello-finto';
import { annullaERimborsa } from '@/lib/ordini/annulla';
import { sendEmail } from '@/lib/email/client';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
const testiEmail = () => vi.mocked(sendEmail).mock.calls.map((c) => (c[0] as { text: string; html: string }));
const campanella = () =>
  (db.tabelle.notifications ?? []).filter((n) => n.user_id === 'u1').map((n) => String(n.body));
/** Nessuna frase può promettere di rendere tutto quando torna una parte. */
const PROMESSA_DI_TUTTO = /ti torna tutto|torna(no)? tutt|per intero|integral|rimborso (completo|totale)/i;
const scaduto = '2026-10-20T08:00:00Z';
const adesso = () => new Date().toISOString();

beforeEach(() => {
  refundOrder.mockClear();
  vi.mocked(sendEmail).mockClear();
  vi.mocked(notifyAdmins).mockClear();
});

describe('il forno rifiuta in un carrello con la frutta: il cliente legge le cifre nuove', () => {
  it('contanti: email e campanella dicono i 16 € che non paga e i 15 € (invece di 13) alla porta', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'cod');
    db = finto({ orders: ordini, cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta']) });
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(riga('frutta')).toMatchObject({ total_price: 15, delivery_fee_cents: 300 });

    const email = testiEmail();
    expect(email).toHaveLength(1);
    for (const testo of [email[0].text, email[0].html.replace(/<[^>]+>/g, ' '), ...campanella()]) {
      const t = testo.replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
      expect(t).toMatch(/16 €, cioè 15 € di spesa e 1 € di consegna/);
      expect(t).toMatch(/#FRUTTA ora è 3 € invece di 1 €, perché ora il giro passa da un negozio solo/);
      expect(t).toMatch(/alla porta paghi 15 € invece di 13 €/);
      expect(t).not.toMatch(PROMESSA_DI_TUTTO);
    }
    expect(campanella().length).toBeGreaterThan(0);
  });

  it('carta: oltre al «Rimborso emesso», email e campanella dicono i 16 € e che la frutta resta pagata, 15 €', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card');
    db = finto({ orders: ordini });
    await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(refundOrder.mock.calls[0][0]).toMatchObject({ amountCents: 1600 });

    const email = testiEmail();
    expect(email).toHaveLength(1);
    for (const testo of [email[0].text, ...campanella()]) {
      expect(testo).toMatch(/ti tornano 16 € sulla carta, cioè 15 € di spesa e 1 € di consegna/);
      expect(testo).toMatch(/#FRUTTA ora è 3 € invece di 1 €/);
      expect(testo).toMatch(/quell'ordine resta pagato, 15 €/);
      expect(testo).not.toMatch(PROMESSA_DI_TUTTO);
      expect(testo).not.toMatch(/alla porta/);
    }
    expect(campanella().length).toBeGreaterThan(0);
  });

  it('carrello di un negozio solo: l email resta quella di oggi e la campanella non parla di carrello', async () => {
    const ordini = carrello(['pane'], [1500], 'cod');
    db = finto({ orders: ordini });
    await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    const email = testiEmail();
    expect(email).toHaveLength(1);
    expect(email[0].text).not.toMatch(/invece di|giro passa|alla porta paghi/);
    expect(campanella()).toEqual([]);
  });

  it('giro degli scaduti, contanti: la carne non conferma in tempo e pane e frutta leggono la loro consegna nuova', async () => {
    const ordini = carrello(['carne', 'pane', 'frutta'], [2000, 1500, 1200], 'cod', { creati: [scaduto, adesso(), adesso()] });
    db = finto({ orders: ordini, cod_checkout_attempts: tentativoDiCassa(['carne', 'pane', 'frutta']) });
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    await (POST as unknown as () => Promise<unknown>)();
    expect(riga('carne').delivery_status).toBe('CANCELED');
    expect(riga('pane')).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });

    const testo = testiEmail().map((e) => e.text).join('\n');
    expect(testo).toMatch(/non paghi i suoi 21 €, cioè 20 € di spesa e 1 € di consegna/);
    expect(testo).toMatch(/#PANE ora è 3 € invece di 1 €, perché ora il giro passa da 2 negozi: alla porta paghi 18 € invece di 16 €/);
    expect(testo).toMatch(/#FRUTTA non cambia: alla porta paghi 13 €/);
    expect(testo).not.toMatch(PROMESSA_DI_TUTTO);
    expect(campanella().join('\n')).toMatch(/alla porta paghi 18 € invece di 16 €/);
  });
});

describe('il rimborso dopo un rifiuto non si può fare: chi chiude a mano sa che il carrello è già riscritto', () => {
  it('giro degli scaduti, carta: l avviso agli amministratori dice il conto nuovo del pane e della frutta', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', { creati: [scaduto, adesso()] });
    db = finto({ orders: ordini });
    refundOrder.mockRejectedValueOnce(Object.assign(new Error('niente da rimborsare'), { ritentabile: false }));
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    await (POST as unknown as () => Promise<unknown>)();
    expect(riga('pane').delivery_status).toBe('CANCELED');
    expect(riga('frutta')).toMatchObject({ total_price: 15, delivery_fee_cents: 300 });

    const avvisi = vi.mocked(notifyAdmins).mock.calls.map((c) => String(c[1]));
    expect(avvisi).toHaveLength(1);
    expect(avvisi[0]).toMatch(/conto nuovo è 16 € \(era 18 €\)/);
    expect(avvisi[0]).toMatch(/#FRUTTA: consegna 3 € \(era 1 €\), totale 15 € \(era 13 €\)/);
  });
});

describe('prima della migrazione 124 il ricalcolo dopo un rifiuto fa lo stesso conto', () => {
  it('contanti, senza gross_total_cents: la frutta passa a 3 € di consegna e 15 € alla porta', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'cod');
    db = finto({ orders: ordini, cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta']) }, { prima124: true });
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15 });
    expect(riga('frutta')).not.toHaveProperty('gross_total_cents');
  });

  it('carta, senza gross_total_cents: al cliente tornano 16 €, non 18', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card');
    db = finto({ orders: ordini }, { prima124: true });
    await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(refundOrder.mock.calls[0][0]).toMatchObject({ orderId: 'pane', amountCents: 1600 });
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, total_price: 15 });
  });
});
