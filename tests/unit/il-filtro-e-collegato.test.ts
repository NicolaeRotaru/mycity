import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #5 — IL FILTRO ANTI-CONTENUTI-VIETATI ERA SCRITTO PER INTERO E NON ERA
 * COLLEGATO A NESSUNA ROTTA.
 *
 * `lib/ai/moderation.ts` contiene un filtro Trust & Safety completo, con le
 * categorie vietate e la regola «nel dubbio si blocca». Il commento in cima
 * diceva «da cablare nelle route in PR successive», e quelle PR non sono mai
 * arrivate: cercando i suoi nomi in tutto il progetto si trovavano zero usi
 * fuori dal file stesso.
 *
 * La strada scoperta era il testo libero — la descrizione che il venditore fa
 * scrivere all'AI e la chat sul prodotto — più la modifica di una scheda già
 * pubblicata, che può trasformarla in qualcos'altro dopo il controllo iniziale.
 *
 * Qui si prova il comportamento vero: si manda un testo che il filtro rifiuta
 * e si pretende che la rotta risponda male invece che bene.
 */

const risposteFiltro: { allowed: boolean; reason: string } = { allowed: false, reason: 'armi' };
const runMessage = vi.fn();

vi.mock('@/lib/ai/run', () => ({
  runMessage: (...args: unknown[]) => runMessage(...args),
  AiCallError: class extends Error {},
  mapAiError: () => new Response('{}', { status: 502 }),
}));
vi.mock('@/lib/ai/client', () => ({
  MODELS: { fast: 'finto-veloce', smart: 'finto-bravo' },
  AiConfigError: class extends Error {},
}));
vi.mock('@/lib/env', () => ({ env: { anthropicKey: () => 'chiave-finta' } }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: async () => ({ allowed: true }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) =>
      h({ user: { id: 'venditore-1' }, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { store_name: 'Bottega' } }) }) }) }),
  }),
  getAdminSupabase: () => ({}),
}));

beforeEach(() => {
  runMessage.mockReset();
  // Il filtro risponde chiamando il tool `flag`: qui lo si fa rispondere
  // «non ammesso», come farebbe davanti a un testo vietato.
  runMessage.mockImplementation(async ({ feature }: { feature: string }) => {
    if (feature.endsWith('-policy')) {
      return { toolInput: { allowed: risposteFiltro.allowed, reason: risposteFiltro.reason }, text: '' };
    }
    return { text: 'una descrizione qualunque', toolInput: undefined };
  });
});

function richiesta(corpo: Record<string, unknown>): Request {
  return new Request('http://localhost/api/ai/description', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

describe('la rotta che scrive le descrizioni passa dal filtro', () => {
  it('un testo che il filtro rifiuta non arriva al modello', async () => {
    risposteFiltro.allowed = false;
    const { POST } = await import('@/app/api/ai/description/route');
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(
      richiesta({ name: 'coltello a serramanico da combattimento' }),
    );
    expect(res.status).toBe(400);

    // E soprattutto: la chiamata che genera il testo non è mai partita.
    const generazioni = runMessage.mock.calls.filter(
      ([a]) => (a as { feature: string }).feature === 'ai-description',
    );
    expect(generazioni.length).toBe(0);
  });

  it('un testo normale passa e la descrizione viene scritta', async () => {
    risposteFiltro.allowed = true;
    const { POST } = await import('@/app/api/ai/description/route');
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(
      richiesta({ name: 'pane di segale a lievitazione naturale' }),
    );
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.description).toBeTruthy();
  });

  it('se il filtro non risponde, si blocca invece di lasciar passare', async () => {
    // Modello non raggiungibile, risposta tagliata, chiave scaduta: il verdetto
    // manca. Un filtro rotto non deve diventare un timbro automatico.
    runMessage.mockImplementation(async ({ feature }: { feature: string }) => {
      if (feature.endsWith('-policy')) return { toolInput: undefined, text: '' };
      return { text: 'descrizione', toolInput: undefined };
    });
    const { POST } = await import('@/app/api/ai/description/route');
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(
      richiesta({ name: 'un prodotto qualunque' }),
    );
    expect(res.status).toBe(400);
  });
});
