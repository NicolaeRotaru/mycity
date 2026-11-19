import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R02-003 — /api/health/ready guarda anche le foto: se la trasformazione di Supabase risponde con
 * un no netto (403, piano scaduto) il sito non è pronto (503, col motivo); senza foto da provare,
 * o con un controllo che non sa (rete, timeout, 5xx), resta pronto.
 */
const FOTO = 'https://abc.supabase.co/storage/v1/object/public/products/a.jpg';
const stato: { immagini: unknown[][]; lettura: 'subito' | 'mai' } = { immagini: [[FOTO]], lettura: 'subito' };

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (tabella: string) => {
      if (tabella === 'products') {
        const catena: Record<string, unknown> = {};
        catena.select = () => catena;
        catena.eq = () => catena;
        catena.not = () => catena;
        catena.limit = () => catena;
        catena.abortSignal = () => catena;
        catena.then = (ok: (v: unknown) => unknown) =>
          stato.lettura === 'mai'
            ? new Promise(() => {})
            : Promise.resolve({ data: stato.immagini.map((images) => ({ images })), error: null }).then(ok);
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
    stato.lettura = 'subito';
    delete process.env.NEXT_PUBLIC_FOTO_SENZA_TRASFORMAZIONE;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

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
    // La trasformata dice 403 e l'originale dello stesso indirizzo si apre: è la trasformazione.
    vi.stubGlobal('fetch', vi.fn(async (i: string) =>
      new Response('x', { status: String(i).includes('/render/image/') ? 403 : 200 })));
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

  /** Una rete finta: la trasformata e l'originale rispondono col codice dato, riconosciute dall'indirizzo. */
  const rete = (trasformata: number, originale: number) =>
    vi.fn(async (i: string) =>
      new Response('x', { status: String(i).includes('/render/image/') ? trasformata : originale }));

  it('trasformata 404 con originale 404: manca QUELLA foto, non il sito: pronta', async () => {
    vi.stubGlobal('fetch', rete(404, 404));
    const r = await chiamata();
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('ready');
  });

  it('trasformata 403 con originale 200: la trasformazione è rotta: non pronta', async () => {
    const f = rete(403, 200);
    vi.stubGlobal('fetch', f);
    const r = await chiamata();
    expect(r.status).toBe(503);
    expect((await r.json()).foto.ok).toBe(false);
    expect(f.mock.calls.map((c) => String(c[0])).some((u) => u.includes('/object/public/') && !u.includes('/render/'))).toBe(true);
  });

  it('trasformata 400 con originale 200: non pronta', async () => {
    vi.stubGlobal('fetch', rete(400, 200));
    expect((await chiamata()).status).toBe(503);
  });

  it('trasformata 4xx con originale 5xx o in errore di rete: pronta', async () => {
    vi.stubGlobal('fetch', rete(403, 502));
    expect((await chiamata()).status).toBe(200);
    vi.stubGlobal('fetch', vi.fn(async (i: string) => {
      if (String(i).includes('/render/image/')) return new Response('no', { status: 403 });
      throw new TypeError('fetch failed');
    }));
    expect((await chiamata()).status).toBe(200);
  });

  it('tetto superato (lettura dei prodotti che non risponde): pronta, entro 2,5 s', async () => {
    vi.useFakeTimers();
    stato.lettura = 'mai';
    vi.stubGlobal('fetch', rete(403, 200));
    let chiusa = false;
    const p = chiamata().then((r) => { chiusa = true; return r; });
    await vi.advanceTimersByTimeAsync(2600);
    expect(chiusa).toBe(true);
    const r = await p;
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('ready');
  });

  it('tetto superato (la foto non risponde): pronta, e il fetch è annullato', async () => {
    vi.useFakeTimers();
    let segnale: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_i: string, init?: RequestInit) => {
      segnale = init?.signal as AbortSignal;
      return new Promise<Response>(() => {});
    }));
    let chiusa = false;
    const p = chiamata().then((r) => { chiusa = true; return r; });
    await vi.advanceTimersByTimeAsync(2600);
    expect(chiusa).toBe(true);
    expect(segnale?.aborted).toBe(true);
    expect((await p).status).toBe(200);
  });
});
