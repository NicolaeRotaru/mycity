import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 27/8/2026 (R146) — LA CHAT DEL CATALOGO MANDAVA AL MODELLO INDIRIZZI DI FOTO
 * SCELTI DA CHIUNQUE.
 *
 * La stessa rotta aveva due filtri diversi a venti righe di distanza. Nel ramo
 * «identificazione» le miniature del catalogo passavano da `sanitizeImageUrls`,
 * che ammette solo gli host da cui ospitiamo le foto. Nel ramo «focus» il
 * filtro era scritto in casa ed era «purché cominci per http»: qualunque
 * indirizzo passava.
 *
 * Non è teorico: le foto dei prodotti importati da altri marketplace nascono
 * come indirizzi esterni (import-fetch → la pagina di creazione prodotto), e il
 * ri-ospitamento è un passaggio a parte, non obbligatorio. Il risultato: i
 * server di Anthropic scaricano un indirizzo scelto dal venditore, i byte li
 * paghiamo noi, il sito di destinazione vede il traffico, e il contenuto di
 * quell'immagine può cambiare dopo. Per un modello che guarda le foto,
 * un'immagine con dentro delle istruzioni scritte è una porta d'ingresso vera.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const FOTO_NOSTRA = 'https://abcdefgh.supabase.co/storage/v1/object/public/products/lampada.jpg';
const FOTO_ALTRUI = 'https://sito-di-un-altro.example/foto-che-posso-cambiare.jpg';

const PRODOTTO = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Lampada', description: 'x', price: 20, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 3, status: 'available', category_id: 'casa',
  images: [FOTO_ALTRUI, FOTO_NOSTRA], attributes: {}, tags: [], has_variants: false,
};
const CATEGORIE = [{ id: 'casa', name: 'Casa', slug: 'casa', parent_id: null }];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [PRODOTTO], error: null }) }) }) }) }
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

function richiesta(corpo: unknown): never {
  return new Request('http://localhost/api/ai/catalog-chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

/** Tutti gli indirizzi di immagine che la rotta ha davvero mandato al modello. */
function fotoMandate(): string[] {
  const arg = runMessageMock.mock.calls[0][0] as {
    messages: { content: unknown }[];
  };
  const urls: string[] = [];
  for (const m of arg.messages) {
    if (!Array.isArray(m.content)) continue;
    for (const blocco of m.content as { type: string; source?: { url?: string } }[]) {
      if (blocco.type === 'image' && blocco.source?.url) urls.push(blocco.source.url);
    }
  }
  return urls;
}

describe('la chat del catalogo manda al modello solo foto ospitate da noi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ text: 'ok', toolInput: { reply: 'ok' } });
  });

  it('col prodotto aperto, la foto ospitata altrove non parte', async () => {
    const res = await POST(
      richiesta({ focusProductId: PRODOTTO.id, history: [{ role: 'user', content: 'quanto costa?' }] }),
    );
    expect(res.status).toBe(200);
    const mandate = fotoMandate();
    expect(
      mandate,
      'i server del modello scaricano un indirizzo scelto dal venditore: i byte li paghiamo noi e quel sito puo cambiare la foto dopo',
    ).not.toContain(FOTO_ALTRUI);
    expect(mandate).toContain(FOTO_NOSTRA);
  });

  it('anche le foto mandate ora dal venditore passano dallo stesso filtro', async () => {
    await POST(
      richiesta({
        focusProductId: PRODOTTO.id,
        imageUrls: [FOTO_ALTRUI],
        history: [{ role: 'user', content: 'questa qui' }],
      }),
    );
    expect(fotoMandate()).not.toContain(FOTO_ALTRUI);
  });

  it('senza prodotto aperto, la miniatura del catalogo resta filtrata come prima', async () => {
    await POST(richiesta({ history: [{ role: 'user', content: 'qual e la lampada?' }] }));
    expect(fotoMandate()).not.toContain(FOTO_ALTRUI);
  });
});

/**
 * 27/8/2026 (R147) — «FOTO OSPITATE DA NOI» ERA «QUALUNQUE PROGETTO SUPABASE
 * DEL MONDO».
 *
 * Il filtro confrontava l'host con `/\.supabase\.co$/`: passava il
 * sottodominio di qualsiasi progetto Supabase, e un progetto Supabase lo apre
 * chiunque, gratis, in due minuti. Il commento sopra l'elenco prometteva «foto
 * ospitate da noi» e il codice non lo faceva. Il difetto vero e' proprio
 * questo: un controllo che dice di fare una cosa e ne fa un'altra si da' per
 * coperto e nessuno lo guarda piu'.
 */
import { fotoDaHostAmmesso } from '@/lib/ai/productContext';

describe('il filtro delle foto guarda il NOSTRO archivio, non un archivio qualunque', () => {
  it('quando sappiamo qual e il nostro progetto, quello di un altro non passa', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ilnostroprogetto.supabase.co');
    expect(
      fotoDaHostAmmesso('https://ilnostroprogetto.supabase.co/storage/v1/object/public/products/a.jpg'),
    ).toBe(true);
    expect(
      fotoDaHostAmmesso('https://progetto-di-un-altro.supabase.co/storage/v1/object/public/products/a.jpg'),
      'basta aprire un progetto Supabase gratis per rimettere dentro una foto che possiamo cambiare quando vogliamo',
    ).toBe(false);
    vi.unstubAllEnvs();
  });

  it('i due host esterni dichiarati restano ammessi', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ilnostroprogetto.supabase.co');
    expect(fotoDaHostAmmesso('https://placehold.co/600x400.png')).toBe(true);
    expect(fotoDaHostAmmesso('https://images.pexels.com/photos/1/pane.jpg')).toBe(true);
    expect(fotoDaHostAmmesso('https://sito-di-un-altro.example/foto.jpg')).toBe(false);
    vi.unstubAllEnvs();
  });
});
