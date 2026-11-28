import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R05-005 — L'EMAIL DELL'ANNULLO NON FA ASPETTARE LA RICHIESTA, E SE NON PARTE RESTA DA RIPROVARE.
 *
 * Prima l'email al cliente partiva dentro la richiesta che annullava: fino a due tentativi da dieci
 * secondi, e se non partiva restava solo nel registro. Qui `after()` di Next è finto come dentro una
 * richiesta: tiene da parte il lavoro, che si fa partire a mano «dopo la risposta».
 */

const dopo: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => ({
  ...(await orig<object>()),
  after: (lavoro: () => unknown) => void dopo.push(lavoro),
}));
const sendEmail = vi.fn();
vi.mock('@/lib/email/client', () => ({ sendEmail: (m: unknown) => sendEmail(m) }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1' })) }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { finto, carrello } from './carrello-finto';

const ASPETTA = Symbol('la richiesta aspetta ancora');
let db: ReturnType<typeof finto>;
const annulla = () =>
  annullaERimborsa(db as never, { ...db.tabelle.orders[0] } as never, { reason: 'Annullato dal cliente', metadata: { source: 'buyer_cancel' } } as never);
const fraPoco = <T,>(p: Promise<T>) => Promise.race([p, new Promise<typeof ASPETTA>((r) => setTimeout(() => r(ASPETTA), 300))]);

beforeEach(() => {
  dopo.length = 0;
  sendEmail.mockReset();
  vi.mocked(notifyAdmins).mockClear();
  db = finto({ orders: carrello(['pane'], [1500], 'cod'), cod_checkout_attempts: [] });
});

describe('R05-005 · l email dell annullo parte dopo la risposta', () => {
  it('la richiesta risponde senza aspettare l invio (che qui non finisce mai)', async () => {
    // Onda 2 (R06-012) — Le email dopo la risposta stanno in fila (lib/api/dopo-la-risposta.ts): l'invio
    // appeso si sblocca a fine prova, o la fila terrebbe fermo il lavoro della prova dopo per 10 s.
    let sblocca: () => void = () => undefined;
    sendEmail.mockImplementation(() => new Promise((r) => { sblocca = () => r({ ok: true }); }));
    const esito = await fraPoco(annulla());
    expect(esito).not.toBe(ASPETTA);
    expect(esito).toMatchObject({ ok: true });
    expect(db.tabelle.orders[0].delivery_status).toBe('CANCELED');
    // L'email parte dopo la risposta.
    expect(dopo.length).toBe(1);
    const lavoro = dopo[0]() as Promise<unknown>;
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    sblocca();
    await lavoro;
  });

  it('un invio fallito lascia agli amministratori un avviso da riprovare, non solo il registro', async () => {
    sendEmail.mockResolvedValue({ ok: false, error: 'la posta non risponde' });
    expect(await fraPoco(annulla())).toMatchObject({ ok: true });
    for (const lavoro of dopo) await lavoro();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const avviso = vi.mocked(notifyAdmins).mock.calls.find((c) => /Email di annullo non partita/.test(String(c[0])));
    expect(avviso).toBeTruthy();
    expect(avviso?.[3]).toMatchObject({ unaVoltaPer: 'email-annullo-pane' });
  });

  it('se l invio riesce gli amministratori non sono disturbati', async () => {
    sendEmail.mockResolvedValue({ ok: true });
    await annulla();
    for (const lavoro of dopo) await lavoro();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyAdmins).mock.calls.some((c) => /Email di annullo/.test(String(c[0])))).toBe(false);
  });
});
