import { describe, it, expect, vi } from 'vitest';

/** R09-002 — il profilo «non trovato» non eredita il canonical della home. */
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'ilike']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: null, error: null });
    return { from: () => q };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: () => {}, warn: () => {}, info: () => {}, spesa: () => {} } }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: () => null }));

import { generateMetadata } from '@/app/u/[handle]/page';

describe('R09-002 profilo pubblico inesistente', () => {
  it('noindex e canonical nullo', async () => {
    const m = (await generateMetadata({ params: Promise.resolve({ handle: 'zzz_nessuno' }) })) as {
      robots: { index: boolean };
      alternates?: { canonical: unknown };
    };
    expect(m.robots.index).toBe(false);
    expect(m.alternates).toBeDefined();
    expect(m.alternates?.canonical).toBeNull();
  });
});
