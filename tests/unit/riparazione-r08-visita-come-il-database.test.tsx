/**
 * @vitest-environment jsdom
 *
 * 21/11/2026 (R08) — POSTHOG CONTA LE VISITE COME IL DATABASE.
 *
 * Il database tiene una visita per persona e prodotto all'ora (trigger product_views_dedup,
 * migrazione 119: la riga doppia sparisce in silenzio, senza errore). Il browser frenava solo per
 * browser: lo stesso cliente su telefono e PC, entro l'ora, dava 2 «product_viewed» a PostHog e 1
 * riga nel database. Qui il database finto fa quello che fa il trigger, con un orologio finto, e la
 * prova conta: gli annunci a PostHog devono essere quante le righe entrate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const mondo = vi.hoisted(() => ({
  righe: [] as Array<{ product_id: string; user_id: string | null; view_fingerprint: string | null; viewed_at: number }>,
  annunci: [] as unknown[],
  utente: 'cliente-1' as string | null,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => ({
      // Come Postgres col trigger della 119: la visita della stessa persona (o della stessa
      // impronta, se anonima) allo stesso prodotto entro un'ora non entra, e nessuno lo dice.
      // Come PostgREST: quante righe sono entrate lo dice solo a chi lo chiede (count).
      insert: async (riga: { product_id: string; user_id: string | null; view_fingerprint: string | null }, opzioni?: { count?: string }) => {
        if (t !== 'product_views') return { data: null, error: null, count: null };
        const ora = Date.now();
        const doppia = mondo.righe.some((r) => r.product_id === riga.product_id
          && (riga.user_id ? r.user_id === riga.user_id : r.user_id === null && r.view_fingerprint === riga.view_fingerprint)
          && ora - r.viewed_at < 3_600_000);
        if (!doppia) mondo.righe.push({ ...riga, viewed_at: ora });
        return { data: null, error: null, count: opzioni?.count ? (doppia ? 0 : 1) : null };
      },
      upsert: async () => ({ data: null, error: null }),
    }),
  },
}));
vi.mock('@/lib/analytics/events', () => ({ trackProductViewed: (...a: unknown[]) => { mondo.annunci.push(a); } }));
vi.mock('@/lib/consent', () => ({ hasConsent: () => true }));
vi.mock('@/components/hooks/useUtente', () => ({ idUtenteInMemoria: async () => mondo.utente }));

import ProductViewTracker from '@/components/ProductViewTracker';

const T0 = Date.parse('2026-11-21T10:00:00Z');
const MINUTI = 60_000;

/** Apre la scheda del prodotto su un dispositivo: ognuno ha il suo archivio del browser. */
async function apriLaScheda(dispositivo: 'telefono' | 'pc', archivi: Record<string, Record<string, string>>) {
  localStorage.clear();
  for (const [k, v] of Object.entries(archivi[dispositivo] ?? {})) localStorage.setItem(k, v);
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  await act(async () => { root.render(createElement(ProductViewTracker, { productId: 'p-1', sellerId: 'negozio-1' } as never)); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  act(() => root.unmount());
  box.remove();
  const copia: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; copia[k] = localStorage.getItem(k)!; }
  archivi[dispositivo] = copia;
}

describe('R08 · una visita per persona e prodotto all\'ora, anche su PostHog', () => {
  beforeEach(() => {
    mondo.righe.length = 0;
    mondo.annunci.length = 0;
    mondo.utente = 'cliente-1';
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('lo stesso cliente su telefono e PC entro l\'ora: una riga e un solo annuncio', async () => {
    const archivi: Record<string, Record<string, string>> = {};
    await apriLaScheda('telefono', archivi);
    expect(mondo.righe).toHaveLength(1);
    expect(mondo.annunci).toHaveLength(1);

    vi.setSystemTime(T0 + 10 * MINUTI);
    await apriLaScheda('pc', archivi);
    expect(mondo.righe, 'il database ne tiene una').toHaveLength(1);
    expect(mondo.annunci, 'PostHog conta quante il database').toHaveLength(mondo.righe.length);
  });

  it('passata l\'ora, la visita dal PC entra nel database e si annuncia', async () => {
    const archivi: Record<string, Record<string, string>> = {};
    await apriLaScheda('telefono', archivi);
    vi.setSystemTime(T0 + 10 * MINUTI);
    await apriLaScheda('pc', archivi);
    vi.setSystemTime(T0 + 61 * MINUTI);
    await apriLaScheda('pc', archivi);
    expect(mondo.righe).toHaveLength(2);
    expect(mondo.annunci).toHaveLength(2);
  });
});
