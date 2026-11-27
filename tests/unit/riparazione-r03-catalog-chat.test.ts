import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 26/11/2026 — NELLA CHAT ASSISTENZA IL NEGOZIANTE APPLICAVA UNA DESCRIZIONE
 * CHE NON AVEVA LETTO, E PERDEVA TAG SENZA CHE NESSUNO LI NOMINASSE.
 *
 * Il forno ha il Panettone con quattro tag e una descrizione scritta a mano.
 * Chiede «aggiungi il tag senza canditi e scrivilo nella descrizione»: il
 * modello propone tags=['senza canditi'] e una riga di descrizione nuova.
 *  - al primo messaggio (nessun prodotto aperto) il modello tag e descrizione
 *    non li ha visti: la proposta su quei campi non esce;
 *  - a scheda aperta la proposta esce, e la risposta mostrata sopra la scheda
 *    porta il testo nuovo da leggere e i tag che spariscono;
 *  - il prompt ha la regola: niente ingredienti, allergeni, origine o «senza…»
 *    che il venditore non ha scritto.
 * Gira la rotta vera con un modello finto: nessuna chiamata AI vera.
 */

const FAKE_USER = { id: 'forno-1', email: 'forno@x.it' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const DESCRIZIONE_A_MANO =
  'Lievitazione di 36 ore con lievito madre, uvetta ammollata nel Marsala, canditi fatti in casa.';
const PANETTONE = {
  id: 'bbbbbbbb-0000-0000-0000-000000000001',
  name: 'Panettone', description: DESCRIZIONE_A_MANO, price: 28, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'alim',
  images: [], attributes: {}, tags: ['dolci', 'natale', 'lievito-madre', 'artigianale-piacenza'], has_variants: false,
};
const CATEGORIE = [{ id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null }];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [PANETTONE], error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: CATEGORIE, error: null }) }) },
  }),
}));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: async () => undefined };
});
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...(a as [])) };
});

import { POST } from '@/app/api/ai/catalog-chat/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

type Risposta = { reply: string; productId: string | null; patch: Record<string, unknown> };

const RICHIESTA = 'aggiungi il tag senza canditi al panettone e scrivilo anche nella descrizione';
const DESCRIZIONE_NUOVA = 'Panettone artigianale senza canditi.';

async function chiedi(corpo: Record<string, unknown>, patch: unknown): Promise<Risposta> {
  runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Fatto, ecco la proposta.', product_id: PANETTONE.id, patch } });
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ history: [{ role: 'user', content: RICHIESTA }], ...corpo }),
    }) as never,
  );
  expect(res.status).toBe(200);
  expect(runMessageMock).toHaveBeenCalledTimes(1);
  return (await res.json()) as Risposta;
}

/** Tutto il testo che e' arrivato al modello (contesto e conversazione). */
function testoAlModello(): string {
  const arg = runMessageMock.mock.calls[0][0] as { messages: { content: unknown }[] };
  return JSON.stringify(arg.messages);
}

describe('chat Assistenza: tag e descrizione si cambiano solo dopo averli visti, e il testo nuovo si legge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('primo messaggio (identificazione): la proposta su tag e descrizione non esce, il modello non li ha visti', async () => {
    const json = await chiedi({}, { tags: ['senza canditi'], description: DESCRIZIONE_NUOVA });
    expect(testoAlModello()).not.toContain('lievito-madre');
    expect(testoAlModello()).not.toContain('Marsala');
    expect(json.productId).toBe(PANETTONE.id);
    expect(json.patch).not.toHaveProperty('tags');
    expect(json.patch).not.toHaveProperty('description');
    expect(json.reply).toMatch(/NON li cambio/);
  });

  it('a scheda aperta: la risposta porta il testo nuovo della descrizione e i tag che spariscono', async () => {
    const json = await chiedi({ focusProductId: PANETTONE.id }, { tags: ['senza canditi'], description: DESCRIZIONE_NUOVA });
    // Tag e descrizione attuali sono arrivati al modello prima della proposta.
    expect(testoAlModello()).toContain('lievito-madre');
    expect(testoAlModello()).toContain('Marsala');
    expect(json.patch).toHaveProperty('description', DESCRIZIONE_NUOVA);
    expect(json.patch).toHaveProperty('tags');
    // Il negoziante legge il testo che sta per applicare…
    expect(json.reply).toContain(DESCRIZIONE_NUOVA);
    // …e vede quali tag spariscono.
    for (const t of PANETTONE.tags) expect(json.reply).toContain(t);
    expect(json.reply).toMatch(/spariscono/);
  });

  it('a scheda aperta, tag tutti tenuti: nessun tag nominato come tolto', async () => {
    const json = await chiedi(
      { focusProductId: PANETTONE.id },
      { tags: ['Dolci', 'natale', 'lievito-madre', 'artigianale-piacenza', 'senza canditi'] },
    );
    expect(json.patch).toHaveProperty('tags');
    expect(json.reply).not.toMatch(/spariscono/);
  });

  it('il prompt della chat vieta ingredienti, allergeni, origine e «senza…» che il venditore non ha scritto', async () => {
    await chiedi({}, undefined);
    const { system } = runMessageMock.mock.calls[0][0] as { system: string };
    const regola = system.split('\n').find((r) => /NON INVENTARE/.test(r)) ?? '';
    expect(regola).toMatch(/description/);
    for (const parola of ['ingredienti', 'allergeni', 'origine', '«senza']) expect(regola).toContain(parola);
  });
});
