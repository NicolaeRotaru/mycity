import { describe, it, expect, vi } from 'vitest';

/**
 * 27/11/2026 — Il sito del Caffè di Piacenza si vede dal vivo nella voce «Sito web»: il portiere lo lascia
 * entrare in frame-src solo col suo indirizzo esatto, mai con tutto *.vercel.app.
 */
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  }),
}));
vi.mock('@/lib/agenzia/lavoro-consegnato/siti', () => ({
  originiDeiSitiOnline: () => ['https://caffe-di-piacenza.vercel.app'],
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

describe('la politica di sicurezza coi siti consegnati', () => {
  it('frame-src contiene il sito online del negozio, e niente domini interi', async () => {
    const r = await middleware(new NextRequest(new URL('https://mycity.test/')));
    const csp = r.headers.get('Content-Security-Policy') ?? '';
    const frameSrc = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('frame-src')) ?? '';
    expect(frameSrc).toContain('https://caffe-di-piacenza.vercel.app');
    expect(frameSrc).not.toContain('*.vercel.app');
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
