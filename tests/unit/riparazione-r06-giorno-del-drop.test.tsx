// @vitest-environment jsdom
/**
 * R06-007 (26/11/2026) — Nella pagina admin dei drop la data «YYYY-MM-DD» del drop
 * veniva letta come mezzanotte UTC e mostrata nel fuso del browser: a New York il
 * drop del 17 appariva come «lun 16 novembre». Qui si disegna la pagina con il fuso
 * di New York e si controlla che il 17 resti il 17.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const drops = [
  { id: 'd1', drop_date: '2026-11-17', discount_percent: 20, original_price: 10, drop_price: 8, headline: null, product: { id: 'p1', name: 'Pane' } },
];

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey.includes('drop-products') ? [] : drops,
    isError: false,
    refetch: () => undefined,
  }),
  useMutation: () => ({ mutate: () => undefined, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));

const TZ_ORIGINALE = process.env.TZ;
afterEach(() => {
  if (TZ_ORIGINALE === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINALE;
});

describe('R06-007 · il giorno del drop nella pagina admin', () => {
  it('a New York il drop del 17 novembre resta il 17', async () => {
    process.env.TZ = 'America/New_York';
    // controllo di sicurezza: in questo fuso la data nuda scivolerebbe al 16
    expect(new Date('2026-11-17').getDate()).toBe(16);
    const { default: Pagina } = await import('@/app/admin/daily-drops/page');
    const html = renderToStaticMarkup(<Pagina />);
    expect(html).toContain('17 novembre');
    expect(html).not.toContain('16 novembre');
  });
});
