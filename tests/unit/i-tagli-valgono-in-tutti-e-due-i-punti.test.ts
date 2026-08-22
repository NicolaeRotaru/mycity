/**
 * 22/8/2026 — TRE TAGLI CHE MANCAVANO, E UNO SCHEMA SCRITTO DUE VOLTE.
 *
 * Ogni testo che parte verso il modello ha un tetto di lunghezza. Serve a due
 * cose: non pagare per un testo che nessuno ha scritto davvero, e non far
 * uscire dalla finestra del modello il resto della scheda.
 *
 * Tre punti non ce l'avevano:
 *  · la descrizione da migliorare era tagliata nel messaggio che va al modello,
 *    ma entrava intera nel filtro di conformita': i due percorsi leggevano
 *    testi diversi;
 *  · nome e categoria non erano tagliati da nessuna delle due parti;
 *  · l'elenco dei campi variante arrivava dal browser gia' composto come testo,
 *    e i tagli che proteggono gli altri elenchi gli passavano accanto.
 *
 * E l'elenco dei campi che l'AI puo' cambiare era ricopiato a mano in due file,
 * gia' scivolati l'uno dall'altro.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      handler({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: { store_name: 'Bottega' }, error: null }) }),
      }),
    }),
  })),
}));
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});
const safeTextMock = vi.fn(async (_testo: string, _dove?: string) => undefined);
vi.mock('@/lib/ai/moderation', () => ({
  assertSafeText: (...a: unknown[]) => safeTextMock(...(a as [string, string?])),
  UnsafeContentError: class extends Error {},
}));

import { POST as POST_DESCRIZIONE } from '@/app/api/ai/description/route';
import { POST as POST_VARIANTI } from '@/app/api/ai/variants/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import {
  PRODUCT_PATCH_PROPERTIES,
  PROPRIETA_EDITORIALI,
  CAMPI_NON_EDITORIALI,
} from '@/lib/ai/patchSchema';

function req(url: string, body: unknown): never {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

describe('la descrizione da migliorare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ text: 'Descrizione nuova.' });
    safeTextMock.mockResolvedValue(undefined);
  });

  it('il filtro e il modello leggono lo stesso testo tagliato', async () => {
    const res = await POST_DESCRIZIONE(
      req('http://localhost/api/ai/description', {
        name: 'N'.repeat(500),
        current: 'D'.repeat(5_000),
        category: 'C'.repeat(500),
      }),
    );
    expect(res.status).toBe(200);

    const testoAlFiltro = String(safeTextMock.mock.calls[0][0]);
    const testoAlModello = String(
      (runMessageMock.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0]
        .content,
    );
    // Nessuno dei due vede piu' di quanto e' consentito.
    expect(testoAlFiltro).not.toContain('D'.repeat(501));
    expect(testoAlModello).not.toContain('D'.repeat(501));
    expect(testoAlFiltro).not.toContain('N'.repeat(201));
    expect(testoAlModello).not.toContain('N'.repeat(201));
    expect(testoAlFiltro).not.toContain('C'.repeat(101));
    expect(testoAlModello).not.toContain('C'.repeat(101));
    // E vedono lo stesso: se il filtro leggesse meno del modello, non starebbe
    // controllando cio' che esce.
    expect(testoAlFiltro).toContain('D'.repeat(500));
    expect(testoAlModello).toContain('D'.repeat(500));
  });
});

describe('l\'elenco dei campi variante', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { axes: [] } });
  });

  it('quaranta campi con sessanta opzioni ciascuno arrivano tagliati', async () => {
    const campi = Array.from({ length: 40 }, (_, i) => ({
      key: `campo${i}`,
      label: `Campo ${i}`,
      type: 'select',
      options: Array.from({ length: 60 }, (_, j) => `opzione${j}`),
    }));
    const res = await POST_VARIANTI(
      req('http://localhost/api/ai/variants', {
        product: { name: 'Maglietta' },
        variantableFields: campi,
      }),
    );
    expect(res.status).toBe(200);
    const messaggio = JSON.stringify(runMessageMock.mock.calls[0][0]);
    expect(messaggio).toContain('campo19');
    expect(messaggio).not.toContain('campo20');
    expect(messaggio).toContain('opzione29');
    expect(messaggio).not.toContain('opzione30');
  });
});

describe('l\'elenco dei campi che l\'AI puo\' cambiare', () => {
  it('«Migliora tutto» parte dalla sorgente unica, meno i campi non editoriali', () => {
    for (const campo of CAMPI_NON_EDITORIALI) {
      // Il campo esiste nella sorgente unica: l'esclusione e' una scelta.
      expect(PRODUCT_PATCH_PROPERTIES).toHaveProperty(campo);
      expect(PROPRIETA_EDITORIALI).not.toHaveProperty(campo);
    }
    // Tutto il resto arriva pari pari: nessuna seconda copia da tenere allineata.
    const attesi = Object.keys(PRODUCT_PATCH_PROPERTIES).filter(
      (k) => !(CAMPI_NON_EDITORIALI as readonly string[]).includes(k),
    );
    expect(Object.keys(PROPRIETA_EDITORIALI)).toEqual(attesi);
  });
});
