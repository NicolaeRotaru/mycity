import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 15/11/2026 (R27-002) — IL GIRO DEGLI ORDINI SCADUTI RENDE MERCE E CREDITO CON LE REGOLE DELL'ANNULLO.
 *
 * Il giro aveva una copia sua della restituzione: un tentativo solo per il credito MyCity, la merce
 * con una chiamata che, se lanciava, faceva saltare tutto il resto, e niente credito trattenuto dal
 * carrello rifatto. Adesso usa gli stessi passi di `annullaERimborsa` (lib/ordini/annulla.ts):
 *  · il credito che cade una volta torna al secondo tentativo, come nell'annullo;
 *  · la merce che non torna a scaffale non ferma il credito e l'email dell'ordine già annullato;
 *  · col carrello rifatto torna il credito meno quello passato agli ordini rimasti (R27-018).
 */

const refundOrder = vi.fn(async (_a: { orderId: string; amountCents: number }) => ({ refundId: 're_1' }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
const spedite: Array<{ text: string }> = [];
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { text: string }) => {
    spedite.push(m);
    return { ok: true };
  }),
}));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { finto, carrello } from './carrello-finto';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

const scaduto = '2026-10-20T08:00:00Z';
async function giro(): Promise<Record<string, number>> {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return ((await (POST as unknown as () => Promise<Response>)()).json());
}
const avvisi = () => vi.mocked(notifyAdmins).mock.calls.map((c) => `${c[0]} ${c[1]}`);
let chiamate: Array<{ nome: string; args: Record<string, unknown> }> = [];
function conRpc(risposta: (nome: string, volta: number) => { error: { message: string } | null } | 'lancia') {
  chiamate = [];
  db.rpc = (async (nome: string, args: Record<string, unknown>) => {
    chiamate.push({ nome, args });
    const r = risposta(nome, chiamate.filter((c) => c.nome === nome).length);
    if (r === 'lancia') throw new Error('connessione persa');
    return { data: null, ...r };
  }) as never;
}
const crediti = () => chiamate.filter((c) => c.nome === 'wallet_credit').map((c) => [c.args.p_cents, c.args.p_reason]);

beforeEach(() => {
  refundOrder.mockClear();
  vi.mocked(notifyAdmins).mockClear();
  spedite.length = 0;
});

describe('R27-002 — il giro degli scaduti usa le regole dell annullo', () => {
  it('il credito MyCity che cade al primo tentativo torna al secondo: 5 € resi, nessun avviso, l email lo dice', async () => {
    const ordini = carrello(['pane'], [1500], 'cod', { creati: [scaduto] });
    ordini[0].wallet_applied_cents = 500;
    ordini[0].total_price = 13;
    db = finto({ orders: ordini });
    conRpc((nome, volta) => (nome === 'wallet_credit' && volta === 1 ? { error: { message: 'timeout' } } : { error: null }));
    const j = await giro();
    expect(crediti()).toEqual([[500, 'order_auto_canceled'], [500, 'order_auto_canceled']]);
    expect(j).toMatchObject({ canceled: 1, ripristiniFalliti: 0 });
    expect(avvisi().filter((a) => /credito/i.test(a))).toEqual([]);
    expect(spedite.map((m) => m.text).join('\n')).toMatch(/\(5,00\s€\) ti è stato restituito/u);
  });

  it('la merce che non torna a scaffale (la chiamata lancia) non ferma il credito e l email dell ordine annullato', async () => {
    const ordini = carrello(['pane'], [1500], 'cod', { creati: [scaduto] });
    ordini[0].wallet_applied_cents = 500;
    ordini[0].total_price = 13;
    db = finto({ orders: ordini });
    conRpc((nome) => (nome === 'restore_stock_for_order' ? 'lancia' : { error: null }));
    const j = await giro();
    expect(j).toMatchObject({ canceled: 1, failed: 0, ripristiniFalliti: 1 });
    expect(crediti()).toEqual([[500, 'order_auto_canceled']]);
    expect(avvisi().some((a) => /merce non è tornata/.test(a))).toBe(true);
    expect(spedite).toHaveLength(1);
  });

  it('pane tutto a credito e frutta con la carta, il pane scade: dal giro tornano 16 € di credito e non 18', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', { creati: [scaduto, new Date().toISOString()] });
    ordini[0].wallet_applied_cents = 1800;
    ordini[0].total_price = 0;
    db = finto({ orders: ordini });
    conRpc(() => ({ error: null }));
    await giro();
    expect(crediti()).toEqual([[1600, 'order_auto_canceled']]);
    expect(db.tabelle.orders.find((r) => r.id === 'frutta')).toMatchObject({ total_price: 13, wallet_applied_cents: 200, delivery_fee_cents: 300 });
  });
});
