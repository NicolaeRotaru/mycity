import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultHomeSite, homeEnabledSections } from '@/lib/home-site';

/**
 * R09-004 — leggiConfigurazioneHome non guardava `error`: un guasto di due secondi diventava la home
 * di fabbrica, e unstable_cache la serviva a tutti per 60 secondi. Adesso l'errore non entra in
 * memoria: la richiesta col guasto ripiega da sola, la successiva rilegge la home vera.
 */
const stato: { guasto: boolean } = { guasto: false };
const warn = vi.fn();
const salvata = { version: 1, sections: [defaultHomeSite().sections[1]] };

// Una memoria come quella di Next: salva solo quello che la funzione ha restituito, non un errore.
vi.mock('next/cache', () => ({
  unstable_cache: <T,>(fn: () => Promise<T>) => {
    let tenuto: { v: T } | null = null;
    return async () => {
      if (tenuto) return tenuto.v;
      const v = await fn();
      tenuto = { v };
      return v;
    };
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/queries/precarico', () => ({ precaricaHome: async () => ({ mutations: [], queries: [] }) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (stato.guasto
            ? { data: null, error: { message: '503 Service Unavailable' } }
            : { data: { home_site: salvata }, error: null }),
        }),
      }),
    }),
  }),
}));

type Elemento = { props: { children?: unknown; sections?: unknown } };
function sezioniDi(el: unknown): string[] {
  const radice = el as Elemento;
  const figli = radice.props.children as unknown[];
  const confine = figli[1] as Elemento;
  const renderer = confine.props.children as Elemento;
  return (renderer.props.sections as Array<{ id: string }>).map((s) => s.id);
}

beforeEach(() => { warn.mockClear(); });

describe('R09-004 · un guasto del database non mette in memoria la home di fabbrica', () => {
  it('la richiesta col guasto ripiega e lo scrive; quella dopo legge la home salvata', async () => {
    const { default: Home } = await import('@/app/page');
    stato.guasto = true;
    const primo = await Home();
    expect(sezioniDi(primo)).toEqual(homeEnabledSections(defaultHomeSite()).map((s) => s.id));
    expect(warn).toHaveBeenCalled();

    stato.guasto = false;
    const secondo = await Home();
    expect(sezioniDi(secondo)).toEqual(homeEnabledSections(salvata as ReturnType<typeof defaultHomeSite>).map((s) => s.id));
    // L'import della pagina vera è pesante: con molte prove in parallelo supera i 5 secondi di base.
  }, 30_000);
});
