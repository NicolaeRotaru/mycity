import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R04-018 — Se il carrello scade tutto nello stesso giro, il cliente non riceve avvisi «il conto è
 * cambiato» con cifre già superate.
 *
 * Il giro degli ordini scaduti annulla gli ordini uno alla volta, e ognuno rifà la consegna degli
 * altri ordini del carrello. Prima ogni annullo diceva subito al cliente le cifre di quel momento:
 * pane e frutta scaduti insieme, l'avviso del pane diceva «la frutta ora costa 15 € invece di 13», e
 * la frutta un attimo dopo era annullata anche lei. Adesso gli avvisi partono a fine giro con le cifre
 * finali. (Banco di prova copiato da dopo-un-annullo-nel-carrello-il-cliente-sa-le-cifre-nuove.test.ts.)
 */

vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1' })) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { finto, carrello, tentativoDiCassa } from './carrello-finto';
import { sendEmail } from '@/lib/email/client';

const ADESSO = '2026-10-21T10:00:00.000Z';
const SCADUTO = '2026-10-20T08:00:00.000Z';
const SCADUTO_DOPO = '2026-10-20T08:00:01.000Z';

const nb = (s: string) => s.replace(/ /g, ' ');
const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
/** Le email al cliente (quelle ai negozi nominano anche loro l'ordine). */
const email = () =>
  vi.mocked(sendEmail).mock.calls
    .map((c) => c[0] as { to: string; text: string })
    .filter((m) => m.to === 'u1@esempio.it')
    .map((m) => nb(String(m.text)));
const contoCambiato = () =>
  (db.tabelle.notifications ?? [])
    .filter((n) => n.user_id === 'u1' && n.title === 'Il conto del tuo carrello è cambiato')
    .map((n) => nb(String(n.body)));

async function giro() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return (POST as unknown as () => Promise<Response>)();
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(ADESSO), toFake: ['Date'] });
  vi.mocked(sendEmail).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('R04-018 · il carrello scaduto nello stesso giro: il cliente legge le cifre finali', () => {
  it('pane e frutta scadono insieme: nessun «conto cambiato» con la frutta a 15 €', async () => {
    db = finto({
      orders: carrello(['pane', 'frutta'], [1500, 1200], 'cod', { creati: [SCADUTO, SCADUTO_DOPO] }),
      cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta']),
    });
    await giro();
    expect(riga('pane').delivery_status).toBe('CANCELED');
    expect(riga('frutta').delivery_status).toBe('CANCELED');
    expect(contoCambiato(), 'la campanella dice un conto che non esiste più').toEqual([]);
    const testi = email().join('\n');
    expect(testi).not.toMatch(/#FRUTTA ora è/);
    expect(testi).not.toMatch(/alla porta paghi 15,00 €/);
    // Due email di annullo, una per ordine.
    expect(email().filter((t) => /#PANE/.test(t))).toHaveLength(1);
    expect(email().filter((t) => /#FRUTTA/.test(t))).toHaveLength(1);
  });

  it('carne e pane scadono, la frutta resta: un avviso solo, con le cifre finali e quelle della conferma', async () => {
    db = finto({
      orders: carrello(['carne', 'pane', 'frutta'], [2000, 1500, 1200], 'cod', { creati: [SCADUTO, SCADUTO_DOPO, ADESSO] }),
      cod_checkout_attempts: tentativoDiCassa(['carne', 'pane', 'frutta']),
    });
    await giro();
    expect(riga('carne').delivery_status).toBe('CANCELED');
    expect(riga('pane').delivery_status).toBe('CANCELED');
    expect(riga('frutta')).toMatchObject({ delivery_status: 'NEW', delivery_fee_cents: 300, total_price: 15 });

    const campanella = contoCambiato();
    expect(campanella, 'un avviso «conto cambiato» solo').toHaveLength(1);
    expect(campanella[0]).toMatch(/#FRUTTA ora è 3,00 € invece di 1,00 €, perché ora il giro passa da un negozio solo: alla porta paghi 15,00 € invece di 13,00 €/);

    const testi = email().join('\n');
    // Nessuna cifra già superata: il pane annullato non «costa 18 €», la frutta non «resta a 13 €».
    expect(testi).not.toMatch(/#PANE ora è/);
    expect(testi).not.toMatch(/alla porta paghi 18,00 €/);
    expect(testi).not.toMatch(/#FRUTTA non cambia/);
    // Il pane si dice con la cifra della conferma (16 €), non con quella del giro (18 €).
    expect(testi).toMatch(/non paghi i suoi 16,00 € della conferma\./);
    expect(testi).toMatch(/non paghi i suoi 23,00 € della conferma\./);
    expect(testi).toMatch(/In tutto alla porta paghi 15,00 € invece di 29,00 €/);
  });

  it('un ordine solo scaduto nel carrello: l avviso resta quello di prima', async () => {
    db = finto({
      orders: carrello(['pane', 'frutta'], [1500, 1200], 'cod', { creati: [SCADUTO, ADESSO] }),
      cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta']),
    });
    await giro();
    expect(contoCambiato()).toHaveLength(1);
    expect(contoCambiato()[0]).toMatch(/#FRUTTA ora è 3,00 € invece di 1,00 €.*alla porta paghi 15,00 € invece di 13,00 €/);
    expect(email().join('\n')).toMatch(/In tutto alla porta paghi 15,00 € invece di 31,00 €/);
  });
});
