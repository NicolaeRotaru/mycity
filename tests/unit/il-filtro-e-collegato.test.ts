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
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
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
    // Una risposta plausibile per tutte le rotte che passano di qui: chi legge
    // `text` trova il testo, chi legge lo strumento trova un patch valido.
    return {
      text: 'una descrizione qualunque',
      toolInput: {
        patch: { name: 'Pane di segale', description: 'Cotto a legna ogni mattina.' },
        summary: 'tutto a posto',
        issues: [],
        axes: [],
      },
    };
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

/**
 * 27/8/2026 (R148) — LE CINQUE ROTTE CHE NON CI PASSAVANO.
 *
 * Contando gli usi veri di `assertSafeText`/`classifyProductPolicy` nelle
 * diciannove rotte AI, cinque erano scoperte: migliora-prodotto, diagnosi,
 * SEO, traduzione, varianti. Tutte e cinque accettano `body.product` dal
 * browser col solo controllo «è un oggetto» e ne mettono nome e descrizione nel
 * prompt; «migliora prodotto» per giunta gira sul modello grande con la ricerca
 * sul web accesa, e quello che produce torna nel form e da lì nel database.
 *
 * Il difetto non era «manca un controllo»: era che il controllo c'era su nove
 * porte e non su cinque, e quale fosse aperta dipendeva da quale pulsante
 * premeva il venditore.
 *
 * Da qui in poi il collegamento non si può staccare in silenzio: se qualcuno lo
 * toglie da una di queste rotte, questo file diventa rosso.
 */
const SCHEDA_VIETATA = {
  name: 'coltello a serramanico da combattimento',
  description: 'lama di 12 cm, apertura rapida',
  price: 40,
};
const SCHEDA_NORMALE = {
  name: 'pane di segale a lievitazione naturale',
  description: 'cotto a legna ogni mattina',
  price: 4,
};

const ROTTE_CON_SCHEDA: { nome: string; modulo: string; feature: string; corpo: (p: unknown) => Record<string, unknown> }[] = [
  { nome: 'migliora prodotto', modulo: '@/app/api/ai/improve-product/route', feature: 'ai-improve-product', corpo: (product) => ({ product }) },
  { nome: 'diagnosi', modulo: '@/app/api/ai/diagnose/route', feature: 'ai-diagnose', corpo: (product) => ({ product }) },
  { nome: 'SEO', modulo: '@/app/api/ai/seo/route', feature: 'ai-seo', corpo: (product) => ({ product }) },
  { nome: 'traduzione', modulo: '@/app/api/ai/translate/route', feature: 'ai-translate', corpo: (product) => ({ product, targetLang: 'en' }) },
  {
    nome: 'varianti',
    modulo: '@/app/api/ai/variants/route',
    feature: 'ai-variants',
    corpo: (product) => ({ product, variantableFields: [{ key: 'colore', type: 'select', options: ['rosso', 'blu'] }] }),
  },
];

describe('anche le rotte che lavorano su una scheda gia scritta passano dal filtro', () => {
  for (const rotta of ROTTE_CON_SCHEDA) {
    it(`${rotta.nome}: una scheda che il filtro rifiuta non arriva al modello`, async () => {
      risposteFiltro.allowed = false;
      const { POST } = (await import(rotta.modulo)) as { POST: (r: Request) => Promise<Response> };
      const res = await POST(
        new Request(`http://localhost/api/ai/${rotta.nome}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(rotta.corpo(SCHEDA_VIETATA)),
        }),
      );
      expect(res.status, `la scheda vietata e passata: ${rotta.nome} ha risposto ${res.status}`).toBe(400);
      const generazioni = runMessage.mock.calls.filter(
        ([a]) => (a as { feature: string }).feature === rotta.feature,
      );
      expect(
        generazioni.length,
        `il filtro ha detto no ma ${rotta.nome} ha chiamato il modello lo stesso`,
      ).toBe(0);
    });

    it(`${rotta.nome}: una scheda normale passa e il lavoro si fa`, async () => {
      risposteFiltro.allowed = true;
      const { POST } = (await import(rotta.modulo)) as { POST: (r: Request) => Promise<Response> };
      const res = await POST(
        new Request(`http://localhost/api/ai/${rotta.nome}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(rotta.corpo(SCHEDA_NORMALE)),
        }),
      );
      expect(res.status).toBeLessThan(400);
      const generazioni = runMessage.mock.calls.filter(
        ([a]) => (a as { feature: string }).feature === rotta.feature,
      );
      expect(generazioni.length).toBe(1);
    });
  }
});
