import { describe, it, expect, vi } from 'vitest';
import zlib from 'node:zlib';
import type { NextRequest } from 'next/server';

// R16-016: l'etichetta dice quando consegnare (veloce o fascia col giorno vero).

const stato: { ordine: Record<string, unknown>; selezione: string; costruita: unknown } = {
  ordine: {}, selezione: '', costruita: null,
};

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuthRateLimit: (_o: unknown, h: (c: unknown) => unknown) =>
    (req: unknown, ctx: { params: Record<string, string> }) =>
      h({ req, user: { id: 'negozio-1' }, params: ctx.params }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({
      select: (s: string) => {
        stato.selezione = s;
        return { eq: () => ({ single: async () => ({ data: stato.ordine, error: null }) }) };
      },
    }),
  }),
}));
vi.mock('@/lib/shipping-etichetta/label', () => ({
  buildShippingLabel: async (d: unknown) => { stato.costruita = d; return Buffer.from('pdf'); },
}));

function paroleStampate(pdf: Buffer): string {
  let testo = '';
  let da = 0;
  for (;;) {
    const inizio = pdf.indexOf('stream', da);
    if (inizio < 0) break;
    let s = inizio + 6;
    if (pdf[s] === 0x0d) s++;
    if (pdf[s] === 0x0a) s++;
    const fine = pdf.indexOf('endstream', s);
    if (fine < 0) break;
    try {
      const f = zlib.inflateSync(pdf.subarray(s, fine)).toString('latin1');
      for (const g of f.matchAll(/<([0-9a-fA-F]+)>/g)) testo += Buffer.from(g[1], 'hex').toString('latin1');
    } catch { /* non di testo */ }
    da = fine + 1;
  }
  return testo;
}

describe('R16-016 il contenuto dell etichetta', () => {
  

  const base = {
    orderId: 'a1b2c3d4-0000-0000-0000-000000000000', recipientName: 'Mario Rossi', street: 'Via Roma 1',
    zip: '29121', city: 'Piacenza', phone: '1', sellerName: 'Forno', totalCents: 1000, isCod: false,
  };

  it('la veloce esce con CONSEGNA VELOCE', async () => {
    const { buildShippingLabel } = await vi.importActual<typeof import('@/lib/shipping-etichetta/label')>('@/lib/shipping-etichetta/label');
    const t = paroleStampate(await buildShippingLabel({ ...base, consegna: 'Adesso · arrivo in 30-60 min' } as never));
    expect(t).toContain('CONSEGNA VELOCE');
  });

  it('la fascia esce col giorno e le ore', async () => {
    const { buildShippingLabel } = await vi.importActual<typeof import('@/lib/shipping-etichetta/label')>('@/lib/shipping-etichetta/label');
    const t = paroleStampate(await buildShippingLabel({ ...base, consegna: 'mar 3/11 · 9:00–11:00' } as never));
    expect(t).toContain('CONSEGNA:');
    expect(t).toContain('mar 3/11');
    expect(t).toContain('9:00');
  });
});

describe('R16-016 la rotta passa la consegna all etichetta', () => {
  async function chiama(ordine: Record<string, unknown>) {
    stato.ordine = { id: 'o1', seller_id: 'negozio-1', total_price: 10, payment_method: 'card', profiles: { store_name: 'Forno' }, ...ordine };
    const { GET } = await import('@/app/api/seller/orders/[id]/label/route');
    await (GET as unknown as (r: NextRequest, c: unknown) => Promise<Response>)({} as NextRequest, { params: { id: 'o1' } });
    return stato.costruita as { consegna?: string | null };
  }

  it('legge delivery_slot, created_at e pickup_in_store e dice il giorno vero', async () => {
    const d = await chiama({ delivery_slot: 'Domani · 9:00–11:00', created_at: '2026-11-02T10:00:00Z', pickup_in_store: false });
    expect(stato.selezione).toContain('delivery_slot');
    expect(d.consegna).toBe('mar 3/11 · 9:00–11:00');
  });

  it('la veloce arriva come veloce', async () => {
    const d = await chiama({ delivery_slot: 'Adesso · arrivo in 30-60 min', created_at: '2026-11-02T10:00:00Z' });
    expect(d.consegna).toMatch(/^Adesso/);
  });
});
