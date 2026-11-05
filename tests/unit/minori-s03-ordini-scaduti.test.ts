import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S03 — il giro degli ordini scaduti (schede 2045, 554, 2214, 553, 2232, 1901, 2044, 180, 1876, 2227).
 */
const refundOrder = vi.fn(async (_a: { orderId: string; amountCents: number }) => ({ refundId: 're_1' }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
const spedite: Array<{ text: string; subject: string }> = [];
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { text: string; subject: string }) => {
    // La posta risponde dopo un po': chi non la aspetta finisce il giro prima che parta.
    await new Promise((r) => setTimeout(r, 30));
    spedite.push(m);
    return { ok: true };
  }),
}));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let giroCaduto = false;
vi.mock('@/lib/ordini/annulla', async (orig) => {
  const vero = await orig<typeof import('@/lib/ordini/annulla')>();
  return {
    ...vero,
    // La rilettura del carrello cade (null), come su un errore del database.
    ricalcolaLaConsegnaDelGiro: (...a: Parameters<typeof vero.ricalcolaLaConsegnaDelGiro>) =>
      giroCaduto ? Promise.resolve(null) : vero.ricalcolaLaConsegnaDelGiro(...a),
  };
});
let db: ReturnType<typeof finto>;
let senzaChiave = false;
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    if (senzaChiave) throw new Error('Service role Supabase non configurato');
    return db;
  },
}));

import { finto, carrello, tentativoDiCassa } from './carrello-finto';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

const scaduto = '2026-10-20T08:00:00Z';
const adesso = () => new Date().toISOString();
const nb = (s: string) => s.replace(/ /g, ' ');
async function giro() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return (POST as unknown as () => Promise<Response>)();
}
const avvisi = () => vi.mocked(notifyAdmins).mock.calls.map((c) => `${c[0]} ${c[1]}`);
const rpcChiamate: Array<{ nome: string; args: Record<string, unknown> }> = [];
function conRpc(errori: Record<string, string> = {}) {
  db.rpc = (async (nome: string, args: Record<string, unknown>) => {
    rpcChiamate.push({ nome, args });
    return errori[nome] ? { data: null, error: { message: errori[nome] } } : { data: null, error: null };
  }) as never;
}

beforeEach(() => {
  refundOrder.mockReset();
  refundOrder.mockImplementation(async () => ({ refundId: 're_1' }));
  vi.mocked(notifyAdmins).mockClear();
  spedite.length = 0;
  rpcChiamate.length = 0;
  senzaChiave = false;
  giroCaduto = false;
});

describe('giro degli ordini scaduti', () => {
  it('2045 — senza la chiave di servizio risponde 503, non lancia', async () => {
    senzaChiave = true;
    const r = await giro();
    expect(r.status).toBe(503);
  });

  it('554 — rimborso fallito e ripristino fallito: gli amministratori lo sanno', async () => {
    const ordini = carrello(['pane'], [1500], 'card', { creati: [scaduto] });
    db = finto({ orders: ordini });
    conRpc();
    refundOrder.mockRejectedValueOnce(new Error('stripe 503'));
    // Il ripristino in NEW cade: ogni update che rimette NEW risponde errore.
    const from = db.from;
    db.from = ((t: string) => {
      const q = from(t) as unknown as Record<string, (v: Record<string, unknown>) => unknown>;
      const update = q.update;
      q.update = (v: Record<string, unknown>) => {
        if (v.delivery_status === 'NEW') return { eq: () => ({ eq: async () => ({ error: { message: 'timeout' } }) }) };
        return update(v);
      };
      return q;
    }) as never;
    const r = await giro();
    const j = await r.json();
    expect(avvisi().some((a) => /NON rimborsato/.test(a))).toBe(true);
    expect(j.daChiudereAMano).toBe(1);
  });

  it('2214 — senza giro rifatto il rimborso usa il totale riletto, non quello di inizio giro', async () => {
    const ordini = carrello(['pane'], [1500], 'card', { creati: [scaduto] });
    db = finto({ orders: ordini });
    conRpc();
    giroCaduto = true;
    // Il giro ha letto 18 €; poi, prima del rimborso, sul database l'ordine passa a 20 €
    // (un altro ordine dello stesso carrello scaduto poco prima). Si cambia alla scrittura che annulla.
    const from = db.from;
    db.from = ((t: string) => {
      const q = from(t) as unknown as Record<string, (v: Record<string, unknown>) => unknown>;
      const update = q.update;
      q.update = (v: Record<string, unknown>) => {
        if (v.delivery_status === 'CANCELED') db.tabelle.orders[0].total_price = 20;
        return update(v);
      };
      return q;
    }) as never;
    await giro();
    giroCaduto = false;
    expect(refundOrder.mock.calls[0][0].amountCents).toBe(2000);
  });

  it('553 — il codice sconto non torna se un altro ordine del carrello lo tiene', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', { creati: [scaduto, adesso()] });
    for (const o of ordini) (o as Record<string, unknown>).coupon_code = 'BENVENUTO';
    db = finto({ orders: ordini });
    conRpc();
    await giro();
    expect(rpcChiamate.filter((c) => c.nome === 'release_coupon')).toEqual([]);
  });

  it('553 — da solo, il codice torna legato all ordine', async () => {
    const ordini = carrello(['pane'], [1500], 'card', { creati: [scaduto] });
    (ordini[0] as Record<string, unknown>).coupon_code = 'BENVENUTO';
    db = finto({ orders: ordini });
    conRpc();
    await giro();
    expect(rpcChiamate.find((c) => c.nome === 'release_coupon')?.args).toEqual({ p_code: 'BENVENUTO', p_order_id: 'pane' });
  });

  it('2232 — pagato con la carta e già rimborsato: l email parla di carta, non di «da pagare»', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', { creati: [scaduto, adesso()] });
    (ordini[0] as Record<string, unknown>).payment_status = 'REFUNDED';
    db = finto({ orders: ordini });
    conRpc();
    await giro();
    const t = nb(spedite.map((e) => e.text).join('\n'));
    expect(t).toMatch(/sulla carta/);
    expect(t).not.toMatch(/il suo totale è|non paghi/);
  });

  it('1901 — storno del credito fallito: l email non dice «credito restituito», e gli amministratori lo sanno', async () => {
    const ordini = carrello(['pane'], [1500], 'cod', { creati: [scaduto] });
    (ordini[0] as Record<string, unknown>).wallet_applied_cents = 500;
    db = finto({ orders: ordini });
    conRpc({ wallet_credit: 'rpc giù' });
    const r = await giro();
    expect(spedite).toHaveLength(1);
    expect(spedite[0].text).not.toMatch(/credito MyCity/);
    expect(avvisi().some((a) => /credito MyCity speso/.test(a))).toBe(true);
    expect((await r.json()).ripristiniFalliti).toBe(1);
  });

  it('2044 — merce non tornata a scaffale: avviso e conto nella risposta', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'cod', { creati: [scaduto] }) });
    conRpc({ restore_stock_for_order: 'rpc giù' });
    const r = await giro();
    expect(avvisi().some((a) => /merce non è tornata/.test(a))).toBe(true);
    expect((await r.json()).ripristiniFalliti).toBe(1);
  });

  it('180 — anche il negozio riceve la campanella dell annullo', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'cod', { creati: [scaduto] }) });
    conRpc();
    await giro();
    const alNegozio = (db.tabelle.notifications ?? []).filter((n) => n.user_id === 's0');
    expect(alNegozio).toHaveLength(1);
    expect(String(alNegozio[0].body)).toMatch(/#PANE.*annullato: non è stato accettato in tempo/);
  });

  it('1876 — il giro aspetta l email di annullo prima di rispondere', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'cod', { creati: [scaduto] }) });
    conRpc();
    await giro();
    expect(spedite).toHaveLength(1);
  });

  it('2227 — carta in un carrello: l email del giro porta le cifre del carrello', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', { creati: [scaduto, adesso()] });
    db = finto({ orders: ordini });
    conRpc();
    await giro();
    const t = nb(spedite.map((e) => e.text).join('\n'));
    expect(t).toMatch(/ti tornano 16,00 € sulla carta/);
    expect(t).toMatch(/quell'ordine resta pagato, 15,00 €/);
  });
});

import { readFileSync } from 'node:fs';
describe('2525 — il giro legge i fermi più vecchi per primi', () => {
  it('la lettura dei candidati è ordinata per nascita prima del tetto di cento', () => {
    const src = readFileSync('app/api/cron/expire-stale-orders/route.ts', 'utf8');
    expect(src).toMatch(/\.eq\('delivery_status', 'NEW'\)\s*\.lt\('created_at', cutoff\)\s*\.order\('created_at', \{ ascending: true \}\)\s*\.limit\(100\)/);
  });
});
