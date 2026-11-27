/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * 26/11/2026 (R18-014) — UNA DOMANDA SOTTO UN PRODOTTO SI SEGNALA DA SOLA.
 *
 * Prima una domanda offensiva, o con il numero di telefono di un altro, si poteva segnalare solo
 * segnalando il prodotto e descrivendola nel testo libero: il modulo e la rotta non conoscevano il
 * tipo «domanda» (il database sì, dalla migrazione 364). Adesso sotto ogni domanda c'è «Segnala», il
 * modulo offre motivi adatti a una domanda, la rotta la accetta e la salva, e l'esito «rimosso» parte
 * solo se la domanda è stata nascosta davvero.
 */

const banco = vi.hoisted(() => ({
  domande: [] as Array<Record<string, unknown>>,
  esistenti: { product_questions: [] as Array<Record<string, unknown>> },
  inserite: [] as Array<Record<string, unknown>>,
  segnalazione: null as Record<string, unknown> | null,
  domanda: null as Record<string, unknown> | null,
  comunicate: [] as string[],
}));

vi.mock('next/link', () => ({ default: (p: { children?: unknown }) => p.children ?? null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: async () => true }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isAuthenticated: false, profile: null, isAdmin: false }),
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({ fetchNomiPubblici: async () => new Map() }));
vi.mock('@/lib/supabase/client', () => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'order', 'limit']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve({ data: banco.domande, error: null }).then(ok, ko);
  return { supabase: q };
});

// La rotta vera, con una banca dati finta.
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => h({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/app/api/segnalazioni/esito/comunica', () => ({
  MOTIVAZIONE_MINIMA: 20,
  comunicaEsito: async (_a: unknown, id: string) => {
    banco.comunicate.push(id);
    return { ok: true, segnalanteEmail: 'nessun_recapito', segnalanteNotifica: 'nessun_recapito', venditore: 'non_previsto' };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (t: string) => {
      const filtri: Array<[string, unknown]> = [];
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { filtri.push([c, v]); return q; };
      q.maybeSingle = async () => {
        if (t === 'segnalazioni') return { data: banco.segnalazione, error: null };
        if (t === 'product_questions') {
          if (banco.domanda) return { data: banco.domanda, error: null };
          const r = banco.esistenti.product_questions.find((x) => filtri.every(([c, v]) => x[c] === v));
          return { data: r ?? null, error: null };
        }
        return { data: null, error: null };
      };
      q.insert = (riga: Record<string, unknown> | Record<string, unknown>[]) => {
        if (t === 'segnalazioni') {
          banco.inserite.push(riga as Record<string, unknown>);
          return { select: () => ({ single: async () => ({ data: { id: 'seg-1', created_at: '2026-11-26T10:00:00Z' }, error: null }) }) };
        }
        return Promise.resolve({ error: null });
      };
      q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(ok, ko);
      return q;
    },
  }),
}));

import ProductQA from '@/components/ProductQA';
import { Segnala } from '@/components/Segnala';
import { POST, PATCH } from '@/app/api/segnalazioni/route';

const DOMANDA_ID = '00000000-0000-4000-8000-0000000000d1';

async function disegna(el: ReturnType<typeof createElement>) {
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: new QueryClient() }, el));
  });
  return { box, root };
}

describe('R18-014 · una domanda sotto un prodotto si segnala da sola', () => {
  beforeEach(() => {
    banco.domande = [];
    banco.esistenti.product_questions = [];
    banco.inserite.length = 0;
    banco.segnalazione = null;
    banco.domanda = null;
    banco.comunicate.length = 0;
  });

  it('sotto ogni domanda c è «Segnala questo contenuto»', async () => {
    banco.domande = [
      { id: 'q-1', product_id: 'p-1', author_id: 'u-1', question: 'Chiamatemi al 3331234567', answer: null, answered_at: null, created_at: '2026-11-20T10:00:00Z' },
      { id: 'q-2', product_id: 'p-1', author_id: 'u-2', question: 'È senza glutine?', answer: 'Sì', answered_at: '2026-11-21T10:00:00Z', created_at: '2026-11-21T09:00:00Z' },
    ];
    const { box, root } = await disegna(createElement(ProductQA, { productId: 'p-1', sellerId: 's-1' } as never));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const schede = Array.from(box.querySelectorAll('p')).filter((p) => /Chiamatemi|glutine/.test(p.textContent ?? ''));
    expect(schede).toHaveLength(2);
    const pulsanti = Array.from(box.querySelectorAll('button')).filter((b) => /Segnala questo contenuto/.test(b.textContent ?? ''));
    expect(pulsanti).toHaveLength(2);
    act(() => root.unmount());
  });

  it('il modulo per una domanda offre motivi da domanda, non «prodotto contraffatto»', async () => {
    const { box, root } = await disegna(createElement(Segnala, { tipo: 'domanda', oggettoId: DOMANDA_ID }));
    const apri = Array.from(box.querySelectorAll('button')).find((b) => /Segnala questo contenuto/.test(b.textContent ?? ''))!;
    await act(async () => { apri.click(); });
    const opzioni = Array.from(document.querySelectorAll('#segnala-motivo option')).map((o) => o.textContent ?? '');
    expect(opzioni.length).toBeGreaterThan(0);
    expect(opzioni.join('|')).toMatch(/offensivo/i);
    expect(opzioni.join('|')).not.toMatch(/contraffatto|Recensione/i);
    act(() => root.unmount());
  });

  it('la rotta accetta e salva la segnalazione di una domanda che esiste', async () => {
    banco.esistenti.product_questions = [{ id: DOMANDA_ID }];
    const res = await POST(new Request('http://x/api/segnalazioni', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'domanda', oggettoId: DOMANDA_ID, motivo: 'odio_o_molestie' }),
    }) as never);
    expect(res.status).toBe(201);
    expect(banco.inserite).toHaveLength(1);
    expect(banco.inserite[0]).toMatchObject({ tipo: 'domanda', oggetto_id: DOMANDA_ID, motivo: 'odio_o_molestie' });
  });

  it('una domanda che non esiste: 404, niente salvato', async () => {
    const res = await POST(new Request('http://x/api/segnalazioni', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'domanda', oggettoId: DOMANDA_ID, motivo: 'altro' }),
    }) as never);
    expect(res.status).toBe(404);
    expect(banco.inserite).toEqual([]);
  });

  it('«rimosso» parte solo se la domanda è stata nascosta', async () => {
    const patch = () => (PATCH as unknown as (r: Request) => Promise<Response>)(new Request('http://x/api/segnalazioni', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000042' }),
    }));
    banco.segnalazione = { stato: 'accolta', tipo: 'domanda', oggetto_id: DOMANDA_ID, esito_motivato: 'La domanda riporta il telefono di un altro cliente.' };
    banco.domanda = { is_public: true };
    const ancoraVisibile = await patch();
    expect(ancoraVisibile.status).toBe(409);
    expect(JSON.stringify(await ancoraVisibile.json())).toMatch(/ancora visibile/);
    expect(banco.comunicate).toEqual([]);
    banco.domanda = { is_public: false };
    expect((await patch()).status).toBe(200);
    expect(banco.comunicate).toHaveLength(1);
  });
});
