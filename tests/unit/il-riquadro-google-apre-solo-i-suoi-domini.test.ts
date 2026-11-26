import { describe, it, expect, vi } from 'vitest';

/** 6 · Revisione di sicurezza del 26/11 (mycity#336): la CSP del riquadro Google non apre tutto googleusercontent.com. */
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';
process.env.NEXT_PUBLIC_GOOGLE_MAPS_CHIAVE = 'chiave-del-browser-finta';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

describe('la politica di sicurezza col riquadro Google acceso', () => {
  it('apre le foto dei luoghi, ma non tutto googleusercontent.com (dove stanno anche script)', async () => {
    const r = await middleware(new NextRequest(new URL('https://mycity.test/')));
    const csp = r.headers.get('Content-Security-Policy') ?? '';
    expect(csp).not.toContain('*.googleusercontent.com');
    expect(csp).not.toContain('*.ggpht.com');
    expect(csp).toContain('https://lh3.googleusercontent.com');
    expect(csp).toContain('https://places.googleapis.com');
  });
});
