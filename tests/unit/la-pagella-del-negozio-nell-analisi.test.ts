import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pagella, type DatiPagella } from '@/lib/agenzia/pagella';

/**
 * 24/11/2026 — LA PAGELLA DEL FLUSSO 18 NELLA PAGINA DELL'ANALISI.
 *
 * Nicola: «fai la pagella del flusso 18 nella pagina dell'analisi». Stessa logica e stesse soglie del
 * flusso 18 di n8n (calcola-attivita.js), detta al titolare:
 *  · i conti: prodotti, ordini e incasso a 30 giorni, scontrino medio, clienti tornati, recensioni;
 *  · gli avvisi: soldi non arrivati dopo 24 ore, ordini fermi da 2 ore, fermo da 14 giorni, vetrina, foto…;
 *  · una tabella che non si legge è «non misurato» (null), MAI zero;
 *  · la rotta legge solo i campi che servono, del solo negozio che chiede.
 */

const ADESSO = new Date('2026-11-24T12:00:00Z');
const ore = (h: number) => new Date(ADESSO.getTime() - h * 3_600_000).toISOString();
const giorni = (g: number) => ore(g * 24);

const BASE: DatiPagella = {
  profilo: {
    role: 'seller', approval_status: 'approved', approved_at: giorni(30), created_at: giorni(40),
    stripe_charges_enabled: true, stripe_payouts_enabled: true,
    store_logo: 'https://x.it/l.png', store_media: [{ type: 'image', url: 'https://x.it/1.jpg' }],
    store_description: 'Bar e pasticceria nel cuore di Piacenza, con brioche fatte in casa.', store_hours: { lun: '7-19' }, store_address: 'Via Roma 10',
  },
  prodotti: { righe: [{ status: 'available', images: ['a'], price: 2 }, { status: 'available', images: [], price: 3 }, { status: 'draft', images: ['b'], price: 0 }] },
  ordini: {
    righe: [
      { payment_status: 'PAID', delivery_status: 'DELIVERED', created_at: giorni(3), user_id: 'u1', total_price: 20, payment_method: 'card', payout_at: giorni(2) },
      { payment_status: 'PAID', delivery_status: 'DELIVERED', created_at: giorni(10), user_id: 'u1', total_price: 10, payment_method: 'cod' },
      { payment_status: 'PAID', delivery_status: 'PENDING', created_at: ore(3), user_id: 'u2', total_price: 30, payment_method: 'card' },
      { payment_status: 'PAID', delivery_status: 'DELIVERED', created_at: ore(40), delivered_at: ore(30), user_id: 'u3', total_price: 15, payment_method: 'card' },
      { payment_status: 'FAILED', delivery_status: 'PENDING', created_at: giorni(1), user_id: 'u4', total_price: 99 },
    ],
  },
  recensioni: { righe: [{ rating: 5 }, { rating: 4 }, { rating: 1 }] },
  confronto: { righe: [{ seller_id: 'a' }, { seller_id: 'a' }, { seller_id: 'b' }, { seller_id: 'b' }, { seller_id: 'b' }, { seller_id: 'b' }] },
  adesso: ADESSO,
};

describe('i conti del flusso 18', () => {
  it('prodotti, ordini, incasso, scontrino, clienti tornati, recensioni e confronto', () => {
    const p = pagella(BASE);
    expect(p.stato).toBe('approvato');
    expect(p.puoIncassareConCarta).toBe(true);
    expect(p.numeri).toEqual({
      prodottiInVendita: 2,
      prodottiSenzaFoto: 1,
      prodottiSenzaPrezzo: 1,
      ordini30g: 4, // il fallito non conta
      incasso30g: 75,
      scontrinoMedio30g: 18.75,
      clienti: 3,
      clientiTornati: 1,
      recensioni: 3,
      votoMedio: 3.3,
      mediaProdottiAltriNegozi: 3,
    });
    expect(p.vetrina?.manca).toEqual([]);
  });

  it('gli avvisi con le soglie del 18, detti al titolare', () => {
    const ids = pagella(BASE).avvisi.map((a) => a.id);
    // consegnato da 30 ore, pagato con carta, senza trasferimento → rosso; ordine aperto da 3 ore → fermo
    expect(ids).toEqual(['payout-bloccato', 'senza-foto', 'senza-prezzo', 'ordini-fermi', 'recensioni-basse']);
    const rosso = pagella(BASE).avvisi[0];
    expect(rosso.colore).toBe('rosso');
    expect(rosso.titolo).toContain('i soldi non ti sono ancora stati trasferiti');
  });

  it('niente rosso falso: un ordine pagato ma non ancora consegnato, o consegnato da meno di 24 ore, non è un soldo mancato', () => {
    const p = pagella({ ...BASE, ordini: { righe: [
      { payment_status: 'PAID', delivery_status: 'PENDING', created_at: ore(40), total_price: 10, payment_method: 'card' },
      { payment_status: 'PAID', delivery_status: 'DELIVERED', created_at: ore(40), delivered_at: ore(5), total_price: 10, payment_method: 'card' },
    ] } });
    expect(p.avvisi.map((a) => a.id)).not.toContain('payout-bloccato');
  });

  it('una tabella che non si legge è «non misurato», mai zero; e non accende avvisi', () => {
    const p = pagella({ ...BASE, ordini: null, recensioni: null, prodotti: null });
    expect(p.numeri.ordini30g).toBeNull();
    expect(p.numeri.incasso30g).toBeNull();
    expect(p.numeri.prodottiInVendita).toBeNull();
    expect(p.numeri.recensioni).toBeNull();
    expect(p.avvisi.map((a) => a.id)).not.toContain('nessun-prodotto');
    expect(p.avvisi.map((a) => a.id)).not.toContain('fermo-da-giorni');
    expect(p.nonMisurato).toEqual(['i tuoi prodotti: non letti', 'i tuoi ordini: non letti', 'le tue recensioni: non lette']);
  });

  it('un negozio nuovo: in verifica, niente prodotti, vetrina da completare, carta non pronta', () => {
    const p = pagella({
      ...BASE,
      profilo: { role: 'seller', approval_status: 'pending', approval_requested_at: giorni(3), stripe_charges_enabled: false },
      prodotti: { righe: [] },
      ordini: { righe: [] },
      recensioni: { righe: [] },
    });
    const ids = p.avvisi.map((a) => a.id);
    expect(ids).toEqual(['in-verifica', 'nessun-prodotto', 'vetrina']);
    expect(p.avvisi[0].titolo).toBe('Il tuo negozio è in verifica da 3 giorni');
    expect(p.avvisi[1].cosaFare).toContain('in media 3');
    expect(p.numeri.scontrinoMedio30g).toBeNull();
    expect(p.numeri.ordini30g).toBe(0);
  });

  it('approvato da più di 14 giorni e nessun ordine negli ultimi 14: l avviso del negozio fermo', () => {
    const p = pagella({ ...BASE, ordini: { righe: [{ payment_status: 'PAID', delivery_status: 'DELIVERED', created_at: giorni(20), total_price: 5, payout_at: giorni(19) }] } });
    expect(p.avvisi.map((a) => a.id)).toContain('fermo-da-giorni');
  });

  it('conteggi parziali: lo dice', () => {
    const p = pagella({ ...BASE, ordini: { righe: BASE.ordini!.righe, totale: 3000 } });
    expect(p.nonMisurato).toContain('i tuoi ordini: contati i primi 5 su 3000');
  });
});

// ─── La rotta ─────────────────────────────────────────────────────────────────────────────
const db = vi.hoisted(() => ({ letture: [] as Array<{ tabella: string; colonne: string; filtri: string[] }>, profilo: null as unknown, ruoloErrore: false }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAnchePendingRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'negozio-1' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const l = { tabella, colonne: '', filtri: [] as string[] };
      db.letture.push(l);
      const q: Record<string, unknown> & { singola?: boolean } = {
        select: (c: string) => { l.colonne = c; return q; },
        eq: (k: string, v: string) => { l.filtri.push(`${k}=${v}`); return q; },
        neq: (k: string, v: string) => { l.filtri.push(`${k}!=${v}`); return q; },
        in: () => q, order: () => q, limit: () => q,
        maybeSingle: () => { q.singola = true; return q; },
        then: (ok: (v: unknown) => unknown) => {
          if (q.singola) return Promise.resolve({ data: db.profilo, error: null }).then(ok);
          if (tabella === 'products' && l.filtri.includes('seller_id=negozio-1')) return Promise.resolve({ data: [{ id: 'p1', status: 'available', images: ['a'], price: 2 }], error: null, count: 1 }).then(ok);
          if (tabella === 'products') return Promise.resolve({ data: [{ seller_id: 'altro' }, { seller_id: '11111111-1111-1111-1111-5d9000000001' }], error: null }).then(ok);
          if (tabella === 'orders') return Promise.resolve({ data: null, error: { message: 'giù' } }).then(ok);
          return Promise.resolve({ data: [{ rating: 5 }], error: null }).then(ok);
        },
      };
      return q;
    },
  }),
}));

describe('/api/seller/pagella', () => {
  beforeEach(() => {
    vi.resetModules();
    db.letture = [];
    db.profilo = { role: 'seller', approval_status: 'approved', approved_at: '2026-11-01T00:00:00Z', stripe_charges_enabled: true, stripe_payouts_enabled: true };
  });

  it('legge solo il negozio che chiede, niente dati dei clienti, e una lettura caduta resta «non misurato»', async () => {
    const { GET } = await import('@/app/api/seller/pagella/route');
    const r = await GET(new Request('https://mycity.example/api/seller/pagella') as never);
    const corpo = await r.json();
    expect(r.status).toBe(200);
    expect(corpo.data.numeri.ordini30g).toBeNull();
    expect(corpo.data.numeri.prodottiInVendita).toBe(1);
    expect(corpo.data.numeri.recensioni).toBe(1);
    expect(corpo.data.nonMisurato).toContain('i tuoi ordini: non letti');
    const ordini = db.letture.find((l) => l.tabella === 'orders')!;
    expect(ordini.filtri).toContain('seller_id=negozio-1');
    expect(ordini.colonne).not.toMatch(/delivery_full_name|delivery_phone|delivery_address|delivery_notes/);
    expect(db.letture.find((l) => l.tabella === 'profiles')!.colonne).not.toMatch(/phone|email|iban|full_name/);
    // le recensioni sono quelle del negozio (store_reviews), come nel flusso 18 e nella pagina Recensioni
    expect(db.letture.find((l) => l.tabella === 'store_reviews')!.filtri).toContain('store_id=negozio-1');
    expect(db.letture.some((l) => l.tabella === 'reviews')).toBe(false);
  });

  it('chi non è un negozio non ha la pagella', async () => {
    db.profilo = { role: 'buyer' };
    const { GET } = await import('@/app/api/seller/pagella/route');
    expect((await GET(new Request('https://mycity.example/api/seller/pagella') as never)).status).toBe(403);
  });
});
