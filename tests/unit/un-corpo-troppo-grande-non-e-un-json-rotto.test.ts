import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 27/8/2026 (R153 · R149) — CHI CARICAVA TROPPO LEGGEVA «JSON NON VALIDO».
 *
 * Tutte le rotte AI leggevano il corpo dentro un `try` con un `catch` cieco:
 * un corpo oltre il tetto e un corpo malformato finivano nella stessa risposta,
 * un 400 che diceva «JSON non valido». Il venditore che manda troppe foto non
 * capiva cosa cambiare, e nei nostri registri un limite superato non si
 * distingueva da un errore del browser — quindi un abuso di dimensione non si
 * distingueva da un bug. La classe d'errore col limite vero e lo stato 413
 * esisteva gia' (lib/api/corpo.ts) ed era usata in otto punti del progetto,
 * nessuno dei quali sotto /api/ai.
 *
 * (R149) Nella stessa passata: il codice a barre e il dettato vocale leggevano
 * il corpo col tetto da dodici megabyte delle rotte che ricevono foto, pur non
 * ricevendone nessuna, e componevano nel prompt due elenchi presi dal browser
 * senza nessun taglio.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
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

import { POST as BARCODE } from '@/app/api/ai/barcode-lookup/route';
import { POST as VOICE } from '@/app/api/ai/voice-product/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function richiesta(url: string, corpo: string): never {
  return new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: corpo,
  }) as never;
}

describe('un corpo troppo grande viene detto per quello che e', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { found: true, reply: 'ok', patch: {} } });
  });

  it('oltre il tetto la risposta e 413 e dice qual e il limite', async () => {
    // Due megabyte di roba: sopra il tetto di un JSON senza foto (1 MB).
    const enorme = JSON.stringify({ ean: '8001234567890', zavorra: 'x'.repeat(2 * 1024 * 1024) });
    const res = await BARCODE(richiesta('http://localhost/api/ai/barcode-lookup', enorme));
    expect(
      res.status,
      'a chi carica troppo si risponde «JSON non valido»: non puo capire cosa deve cambiare',
    ).toBe(413);
    const corpo = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(corpo.error?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(corpo.error?.message ?? '').toMatch(/troppo grande/i);
  });

  it('un JSON davvero rotto resta un 400', async () => {
    const res = await BARCODE(richiesta('http://localhost/api/ai/barcode-lookup', '{ questo non e json'));
    expect(res.status).toBe(400);
  });

  it('anche il dettato vocale ha il tetto di un JSON senza foto', async () => {
    const enorme = JSON.stringify({ transcript: 'ciao', zavorra: 'x'.repeat(2 * 1024 * 1024) });
    const res = await VOICE(richiesta('http://localhost/api/ai/voice-product', enorme));
    expect(res.status).toBe(413);
  });
});

describe('gli elenchi che arrivano dal browser non entrano interi nel prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { found: true, reply: 'ok', patch: {} } });
  });

  const attributiGonfiati = Array.from({ length: 300 }, (_, i) => ({ key: `campo_${i}`, type: 'text' }));
  const categorieGonfiate = Array.from({ length: 300 }, (_, i) => ({ name: `Cat ${i}`, slug: `cat-${i}` }));

  function testoMandato(): string {
    const arg = runMessageMock.mock.calls[0][0] as { messages: { content: string }[] };
    return arg.messages[0].content;
  }

  it('il codice a barre taglia attributi e categorie prima di comporre il prompt', async () => {
    await BARCODE(
      richiesta(
        'http://localhost/api/ai/barcode-lookup',
        JSON.stringify({ ean: '8001234567890', attributeSchema: attributiGonfiati, topCategories: categorieGonfiate }),
      ),
    );
    const testo = testoMandato();
    expect(
      testo.includes('campo_299'),
      'un elenco gonfiato apposta entra intero nel prompt: i token li paghiamo noi e il contenuto che conta esce dalla finestra',
    ).toBe(false);
    expect(testo.includes('cat-299')).toBe(false);
    expect(testo).toContain('campo_0');
  });

  it('anche il dettato vocale li taglia', async () => {
    await VOICE(
      richiesta(
        'http://localhost/api/ai/voice-product',
        JSON.stringify({ transcript: 'tre magliette rosse', attributeSchema: attributiGonfiati, topCategories: categorieGonfiate }),
      ),
    );
    const testo = testoMandato();
    expect(testo.includes('campo_299')).toBe(false);
    expect(testo.includes('cat-299')).toBe(false);
  });
});
