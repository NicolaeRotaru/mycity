// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * S05 · schede 344, 296 (chat assistenza), 23 — le richieste di assistenza.
 */

const stato = vi.hoisted(() => ({ filtri: [] as Array<[string, unknown]>, avvisi: [] as unknown[] }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: async () => ({ allowed: true }) }));
vi.mock('@/lib/api/middleware', () => {
  const avvolgi = (soloAdmin: boolean) => (h: (c: unknown) => unknown) => async (req: Request) => {
    const ruolo = req.headers.get('x-ruolo');
    if (!ruolo) return new Response('no', { status: 401 });
    if (soloAdmin && ruolo !== 'admin') return new Response('Solo admin', { status: 403 });
    return h({ req, user: { id: req.headers.get('x-id') ?? 'u' } });
  };
  return { withAdminAuth: avvolgi(true), withAuth: avvolgi(false) };
});
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, order: () => b, limit: () => b,
        eq: (c: string, v: unknown) => { stato.filtri.push([`${t}.${c}`, v]); return b; },
        maybeSingle: async () => ({ data: t === 'profiles' ? { id: 'admin-assistenza' } : null, error: null }),
        insert: (v: unknown) => {
          if (t === 'notifications') stato.avvisi.push(v);
          const r = { error: null, data: { id: 'conv-1' } };
          return Object.assign(Promise.resolve(r), { select: () => ({ single: async () => r }) });
        },
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [{ id: 'c1' }], error: null }).then(ok),
      });
      return b;
    },
  }),
}));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; vi.unstubAllGlobals(); stato.filtri.length = 0; stato.avvisi.length = 0; });

describe('GET /api/admin/assistenza', () => {
  it('344: un secondo admin legge le chat dell’account Assistenza, non le sue; un cliente è rifiutato', async () => {
    const { GET } = await import('@/app/api/admin/assistenza/route');
    const chiama = (ruolo: string, id: string) =>
      (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x', { headers: { 'x-ruolo': ruolo, 'x-id': id } }));
    expect((await chiama('buyer', 'cliente')).status).toBe(403);
    const res = await chiama('admin', 'admin-secondo');
    const j = (await res.json()) as { data: { sonoIo: boolean; conversazioni: unknown[] } };
    expect(j.data.sonoIo).toBe(false);
    expect(j.data.conversazioni).toHaveLength(1);
    expect(stato.filtri).toContainEqual(['conversations.seller_id', 'admin-assistenza']);
    expect(stato.filtri).not.toContainEqual(['conversations.seller_id', 'admin-secondo']);
  });
});

describe('pagina Chat assistenza', () => {
  async function apri(risposta: Response) {
    vi.stubGlobal('fetch', vi.fn(async () => risposta));
    const mod = (await import('@/app/admin/support-chat/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    return r.host;
  }

  it('296: lettura caduta → avviso, non «Nessuna richiesta»', async () => {
    const host = await apri(new Response(JSON.stringify({ ok: false }), { status: 500 }));
    expect(host.textContent).not.toContain('Nessuna richiesta');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('344: a un admin che non è l’Assistenza mostra le richieste e dice da dove si risponde', async () => {
    const conv = { id: 'c1', last_message_at: '2026-11-04T10:00:00Z', last_message_preview: 'Aiuto ordine', seller_unread_count: 1, buyer: { full_name: 'Maria', store_name: null } };
    const host = await apri(new Response(JSON.stringify({ ok: true, data: { sonoIo: false, conversazioni: [conv] } }), { status: 200 }));
    expect(host.textContent).toContain('Maria');
    expect(host.textContent).toContain('account Assistenza');
  });
});

describe('POST /api/support/conversation', () => {
  it('23: la richiesta d’aiuto fa suonare la campanella dell’Assistenza', async () => {
    const { POST } = await import('@/app/api/support/conversation/route');
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://x', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ruolo': 'buyer', 'x-id': 'cliente-1' },
      body: JSON.stringify({ firstMessage: 'Problema con un ordine' }),
    }));
    expect(res.status).toBe(200);
    expect(stato.avvisi).toContainEqual(expect.objectContaining({ user_id: 'admin-assistenza', title: 'Nuova richiesta di assistenza' }));
  });
});
