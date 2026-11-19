import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R02-003 — /api/health/ready guarda anche le foto: se la trasformazione di Supabase risponde con
 * un no netto (403, piano scaduto) il sito non è pronto (503, col motivo); senza foto da provare,
 * o con un controllo che non sa (rete, timeout, 5xx), resta pronto.
 */
const FOTO = 'https://abc.supabase.co/storage/v1/object/public/products/a.jpg';
const stato: { immagini: unknown[][] } = { immagini: [[FOTO]] };

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (tabella: string) => {
      if (tabella === 'products') {
        const catena: Record<string, unknown> = {};
        catena.select = () => catena;
        catena.eq = () => catena;
        catena.not = () => catena;
        catena.limit = () => Promise.resolve({ data: stato.immagini.map((images) => ({ images })), error: null });
        return catena;
      }
      if (tabella === 'cron_heartbeats') return { select: () => Promise.resolve({ data: [], error: null }) };
      return { select: () => ({ limit: () => Promise.resolve({ error: null }) }) };
    },
  })),
}));

import { GET } from '@/app/api/health/ready/route';

const chiamata = () => GET(new Request('https://mycity.test/api/health/ready') as never);

describe('R02-003 · la porta «sei pronto» guarda le foto', () => {
  beforeEach(() => {
    stato.immagini = [[FOTO]];
    delete process.env.NEXT_PUBLIC_FOTO_SENZA_TRASFORMAZIONE;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('foto ok: pronta', async () => {
    const f = vi.fn(async (_i: string, _init?: RequestInit) => new Response('x', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const r = await chiamata();
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain('/storage/v1/render/image/');
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('ready');
  });

  it('foto ko (403): non pronta, 503 come per il database, col motivo nel corpo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
    const r = await chiamata();
    const corpo = await r.json();
    expect(r.status).toBe(503);
    expect(corpo.status).toBe('not_ready');
    expect(corpo.foto.ok).toBe(false);
    expect(corpo.foto.error).toMatch(/foto/);
  });

  it('nessuna foto da provare: pronta e non si chiede niente', async () => {
    stato.immagini = [[], ['https://images.pexels.com/x.jpg']];
    const f = vi.fn(async () => new Response('no', { status: 403 }));
    vi.stubGlobal('fetch', f);
    const r = await chiamata();
    expect(f).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('ready');
  });

  it('errore di rete o 5xx del controllo non è un no netto: resta pronta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect((await chiamata()).status).toBe(200);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 502 })));
    expect((await chiamata()).status).toBe(200);
  });
});
