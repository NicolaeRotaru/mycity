/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R14-010 — La pagina delle notifiche non mostra le promozioni a chi le ha spente (`notif_promos`).
 * Pagina vera, react-query vero, database finto con la colonna `category`.
 */
const globali = globalThis as Record<string, unknown>;
const ora = Date.parse('2026-11-26T10:00:00Z');
const mondo = { promos: false as boolean | null, errorePreferenza: false };

const righe = [
  { id: 'a', category: 'order', title: 'Ordine spedito' },
  { id: 'b', category: 'promo', title: 'Sconto del weekend' },
  { id: 'c', category: 'system', title: 'Avviso di servizio' },
].map((r, i) => ({ ...r, user_id: 'u1', body: null, link: null, is_read: false, created_at: new Date(ora - i * 3_600_000).toISOString() }));

function database() {
  return {
    from: (tavola: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c;
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const esito =
          tavola === 'profiles'
            ? mondo.errorePreferenza
              ? { data: null, error: { message: 'giù' } }
              : { data: [{ notif_promos: mondo.promos }], error: null }
            : { data: righe.map((r) => ({ ...r })), error: null };
        return Promise.resolve(esito).then(ok, ko);
      };
      return c;
    },
  };
}

async function lascia(volte = 20) {
  for (let i = 0; i < volte; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function apri() {
  const pagina = await monta('app/notifications/page.tsx', { veri: ['@tanstack/react-query'] });
  const Pagina = pagina.default as () => unknown;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const s = accendi(() => createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never)));
  await lascia();
  return s;
}

beforeEach(() => {
  mondo.promos = false;
  mondo.errorePreferenza = false;
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = database();
  globali.__ASCOLTI_AUTH__ = [];
  globali.__PERCORSO_FINTO__ = '/notifications';
});
afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__ASCOLTI_AUTH__', '__PERCORSO_FINTO__']) delete globali[k];
});

describe('R14-010 · promozioni spente, niente promozioni nell’elenco', () => {
  it('con le promozioni spente la notifica promozionale non c’è, le altre sì', async () => {
    const s = await apri();
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('Ordine spedito');
    expect(testo).toContain('Avviso di servizio');
    expect(testo).not.toContain('Sconto del weekend');
    s.smonta();
  }, 60000);

  it('se la preferenza non si legge, le promozioni restano fuori', async () => {
    mondo.errorePreferenza = true;
    const s = await apri();
    expect(s.radice.textContent).not.toContain('Sconto del weekend');
    expect(s.radice.textContent).toContain('Ordine spedito');
    s.smonta();
  }, 60000);

  it('con le promozioni accese compaiono', async () => {
    mondo.promos = true;
    const s = await apri();
    expect(s.radice.textContent).toContain('Sconto del weekend');
    s.smonta();
  }, 60000);
});
