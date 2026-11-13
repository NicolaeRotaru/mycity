/**
 * R14-018 — Il riepilogo delle recensioni legge l'interruttore degli strumenti AI.
 *
 * Con `AI_NEGOZI_ACCESA` spento la pagina non mostra il bottone, ma la rotta non
 * lo leggeva: una richiesta fatta a mano consumava il freno, leggeva il prodotto
 * e fino a cento recensioni, e arrivava fino alla chiamata al modello. Qui
 * l'interruttore si finge (cosi' la prova non cambia il giorno in cui Nicola lo
 * riaccende) e si guarda che cosa la rotta fa nei due versi.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const stato = vi.hoisted(() => ({
  aiAccesa: false,
  letture: [] as string[],
  chiamateAi: 0,
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  return { ...vero, get AI_NEGOZI_ACCESA() { return stato.aiAccesa; } };
});

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (c: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    h({ user: { id: 'seller-1' }, req }),
}));

vi.mock('@/lib/ai/run', async (importActual) => {
  const vero = await importActual<typeof import('@/lib/ai/run')>();
  return {
    ...vero,
    runMessage: async () => { stato.chiamateAi++; return { toolInput: { summary: 'Clienti contenti.' } }; },
  };
});

const PRODOTTO = { id: '11111111-1111-1111-1111-111111111111', name: 'Maglietta', seller_id: 'seller-1' };

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      stato.letture.push(tabella);
      return tabella === 'products'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: PRODOTTO, error: null }) }) }) }
        : { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ rating: 5, comment: 'Ottimo' }], error: null }) }) }) }) };
    },
  }),
}));

import { POST } from '@/app/api/ai/reviews-summary/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const chiedi = () =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/ai/reviews-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId: PRODOTTO.id }),
    }),
  );

beforeEach(() => {
  __resetRateLimitBuckets();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  stato.aiAccesa = false;
  stato.letture = [];
  stato.chiamateAi = 0;
});

describe('R14-018 — il riepilogo delle recensioni segue AI_NEGOZI_ACCESA', () => {
  it('spento: 503 «non ancora attivi», nessuna lettura e nessuna chiamata al modello', async () => {
    const res = await chiedi();
    expect(res.status, 'con gli strumenti AI spenti la rotta lavorava lo stesso').toBe(503);
    expect(JSON.stringify(await res.json())).toContain('non sono ancora attivi');
    expect(stato.letture, 'la rotta leggeva prodotto e recensioni anche da spenta').toEqual([]);
    expect(stato.chiamateAi).toBe(0);
  });

  it('spento: anche venti richieste di fila non consumano il freno di chi lo riaccende dopo', async () => {
    for (let i = 0; i < 20; i++) expect((await chiedi()).status).toBe(503);
    stato.aiAccesa = true;
    expect((await chiedi()).status, 'le richieste da spento avevano consumato il freno orario').toBe(200);
  });

  it('acceso (controprova): la sintesi parte come prima', async () => {
    stato.aiAccesa = true;
    const res = await chiedi();
    expect(res.status).toBe(200);
    expect(stato.letture).toEqual(['products', 'reviews']);
    expect(stato.chiamateAi).toBe(1);
  });
});
