import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assignVariant, expHeaderName, type Experiment } from '@/lib/experiments';

/**
 * 30/8/2026 (R173) — CHI RIFIUTA I COOKIE VEDEVA DUE SITI DIVERSI.
 *
 * L'assegnazione della variante del test A/B si conserva in un cookie, e il
 * cookie si scrive solo se c'è il consenso analitico — ed è giusto così. Ma
 * senza cookie la variante veniva RISORTEGGIATA a ogni richiesta: chi non
 * accetta (o non risponde al banner) vedeva la home in una versione, tornava
 * indietro e la trovava nell'altra. E la variante poi registrata al momento del
 * consenso poteva non essere quella che quella persona aveva davvero visto.
 *
 * Adesso la variante si CALCOLA da un valore stabile che la richiesta porta
 * già con sé — l'impronta della sessione, o indirizzo di rete + browser: stessa
 * persona, stessa variante, senza scrivere niente sul dispositivo.
 */

const createServerClient = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => {
    createServerClient(...args);
    return {
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
    };
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

const ESPERIMENTO: Experiment = { key: 'home_hero', variants: ['a', 'b'] as const, enabled: true };

function visita(percorso: string, intestazioni: Record<string, string>) {
  return new NextRequest(new URL(`https://mycity.test${percorso}`), { headers: intestazioni });
}

/** La variante che il middleware passa alla pagina, letta dalla risposta. */
function varianteDecisa(res: Response): string | null {
  return res.headers.get(`x-middleware-request-${expHeaderName('home_hero')}`);
}

const COME_UN_BROWSER = {
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  'x-forwarded-for': '81.56.12.9',
};

beforeEach(() => { createServerClient.mockClear(); });

describe('la variante per chi non ha accettato i cookie', () => {
  it('resta la stessa su tutte le pagine della stessa visita', async () => {
    const viste: (string | null)[] = [];
    for (const percorso of ['/', '/search?q=pane', '/product/abc', '/', '/store/pane-quotidiano', '/']) {
      viste.push(varianteDecisa(await middleware(visita(percorso, COME_UN_BROWSER))));
    }

    expect(viste[0], 'il middleware non ha deciso nessuna variante').toBeTruthy();
    expect(
      new Set(viste).size,
      `la home cambia aspetto mentre si naviga: varianti viste ${viste.join(', ')}`,
    ).toBe(1);
  });

  it('due visitatori diversi non finiscono per forza nello stesso gruppo', async () => {
    // Se il seme fosse uguale per tutti, il test A/B non dividerebbe piu'
    // nessuno: e' l'altro modo di sbagliare, e va escluso.
    const varianti = new Set<string | null>();
    for (let i = 0; i < 40; i++) {
      const res = await middleware(visita('/', {
        'user-agent': `Mozilla/5.0 (browser numero ${i})`,
        'x-forwarded-for': `81.56.12.${i}`,
      }));
      varianti.add(varianteDecisa(res));
    }
    expect(varianti.size, 'tutti i visitatori finiscono nello stesso gruppo').toBeGreaterThan(1);
  });

  it('chi ha già il cookie tiene la variante che ha', async () => {
    const req = visita('/', COME_UN_BROWSER);
    req.cookies.set('mc_exp_home_hero', 'b');
    expect(varianteDecisa(await middleware(req))).toBe('b');
  });
});

describe('la scelta della variante, presa da sola', () => {
  it('con lo stesso seme risponde sempre lo stesso', () => {
    const prima = assignVariant(ESPERIMENTO, 'seme-di-prova');
    for (let i = 0; i < 50; i++) {
      expect(assignVariant(ESPERIMENTO, 'seme-di-prova')).toBe(prima);
    }
  });

  it('semi diversi finiscono in gruppi diversi', () => {
    const gruppi = new Set<string>();
    for (let i = 0; i < 40; i++) gruppi.add(assignVariant(ESPERIMENTO, `visitatore-${i}`));
    expect(gruppi.size).toBe(2);
  });

  it('senza seme resta il sorteggio di prima, e un esperimento spento da sempre il controllo', () => {
    expect(['a', 'b']).toContain(assignVariant(ESPERIMENTO));
    expect(assignVariant({ ...ESPERIMENTO, enabled: false }, 'seme-di-prova')).toBe('a');
  });
});
