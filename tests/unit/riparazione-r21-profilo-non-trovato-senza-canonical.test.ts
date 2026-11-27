import { describe, it, expect, vi } from 'vitest';

/**
 * R21-007 (parte sicura) — I metadati di un profilo pubblico che non esiste hanno canonical nullo, come
 * prodotto, negozio e categoria: noindex più canonical alla home sono due segnali in contraddizione.
 */
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'ilike']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: null, error: null });
    return { from: () => q };
  },
}));

describe('R21-007: /u/<handle> inesistente', () => {
  it('i metadati dicono «non trovato», noindex e nessun canonical', async () => {
    const { generateMetadata } = await import('@/app/u/[handle]/page');
    const m = (await generateMetadata({ params: Promise.resolve({ handle: 'nessuno' }) })) as {
      title: string; robots: { index: boolean }; alternates?: { canonical: unknown };
    };
    expect(m.title).toBe('Profilo non trovato · MyCity');
    expect(m.robots.index).toBe(false);
    expect(m.alternates).toBeDefined();
    expect(m.alternates?.canonical).toBeNull();
  });
});
