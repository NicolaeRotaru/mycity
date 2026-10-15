import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDraftProductInsert } from '@/lib/products/draftFromVision';
import { productSnapshot } from '@/lib/products/aiSnapshot';
import {
  bozzaDaCreare,
  dichiarazioniDellaBozza,
  erroreDiSalvataggio,
  messaggioDopoLaBozza,
} from '@/lib/products/prontoPerLaVendita';
import type { CategoryRow } from '@/lib/products/aiPatch';

/**
 * 15/10/2026 (R36) — DALLA CHAT ASSISTENZA UN ALIMENTO CREATO DALLE FOTO ANDAVA
 * IN VENDITA SCRIVENDO «PUBBLICA», SENZA I CONTROLLI DEL MODULO.
 *
 * Il fornaio manda la foto di una focaccia. La chat legge la foto, prepara la
 * bozza — «Focaccia genovese, 3,50 €» e una riga di descrizione — e lui preme
 * «Crea bozza». La chat risponde: «Vuoi pubblicarla ("pubblica")?». Lui scrive
 * «pubblica», preme «Applica», e la focaccia e' in vendita con Allergeni =
 * «Glutine» (dedotto dal modello, mai visto dal fornaio) e Ingredienti vuoto.
 *
 * Il modulo del prodotto, prima di pubblicare, blocca se mancano i campi
 * obbligatori; la chat no. E quando il database rifiutava, la rotta buttava
 * via il motivo e scriveva «Riprova»: riprovare dava sempre lo stesso errore.
 *
 * Queste prove partono dalla bozza VERA che crea la chat
 * (`buildDraftProductInsert`) e chiamano la ROTTA che la mette in vendita.
 */

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
];

const FOTO = ['https://example.supabase.co/storage/v1/object/public/products/focaccia.jpg'];

/** La bozza che la chat crea dalla foto di una focaccia, come nella scheda R36. */
function bozzaDellaFocaccia(attributi: Record<string, string>) {
  const insert = buildDraftProductInsert({
    draft: {
      name: 'Focaccia genovese',
      description: "Focaccia genovese all'olio", // 26 caratteri, come nello scenario
      category_slug: 'alimentari',
      suggested_price: 3.5,
      attributes: attributi,
      tags: ['focaccia', 'pane'],
    },
    imageUrls: FOTO,
    categories: CATEGORIE,
    sellerId: 'forno-1',
  });
  return { id: 'bozza-focaccia', ...insert, has_variants: false };
}

/* ----------------------------- finto database ----------------------------- */

const db = vi.hoisted(() => ({
  scritture: [] as { id: unknown; valori: Record<string, unknown> }[],
  prodotti: [] as Record<string, unknown>[],
  categorie: [] as Record<string, unknown>[],
  /** L'errore che il database restituisce alla scrittura (null = scrive). */
  errore: null as { code: string; message: string } | null,
}));

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) =>
      h({ user: { id: 'forno-1' }, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: async () => ({ allowed: true }),
}));
vi.mock('@/lib/supabase/server', () => {
  type Stato = { op: 'select' | 'update'; valori: Record<string, unknown> | null; filtri: Record<string, unknown> };
  const risolvi = (tabella: string, s: Stato, una: boolean) => {
    if (tabella === 'categories') return Promise.resolve({ data: db.categorie, error: null });
    if (s.op === 'update') {
      if (db.errore) return Promise.resolve({ data: null, error: db.errore });
      db.scritture.push({ id: s.filtri.id, valori: s.valori ?? {} });
      const riga = db.prodotti.find((p) => p.id === s.filtri.id);
      return Promise.resolve({ data: { ...riga, ...s.valori }, error: null });
    }
    if (una) return Promise.resolve({ data: db.prodotti.find((p) => p.id === s.filtri.id) ?? null, error: null });
    const ids = s.filtri.id as string[] | undefined;
    return Promise.resolve({
      data: db.prodotti.filter((p) => (!ids || ids.includes(p.id as string)) && p.seller_id === 'forno-1'),
      error: null,
    });
  };
  const costruttore = (tabella: string) => {
    const s: Stato = { op: 'select', valori: null, filtri: {} };
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      order: () => q,
      update: (v: Record<string, unknown>) => {
        s.op = 'update';
        s.valori = v;
        return q;
      },
      eq: (c: string, v: unknown) => {
        s.filtri[c] = v;
        return q;
      },
      in: (c: string, v: unknown) => {
        s.filtri[c] = v;
        return q;
      },
      single: () => risolvi(tabella, s, true),
      then: (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => risolvi(tabella, s, false).then(ok, ko),
    });
    return q;
  };
  return { getAdminSupabase: () => ({ from: costruttore }) };
});

async function applica(productId: string, patch: Record<string, unknown>) {
  const { POST } = (await import('@/app/api/ai/catalog-apply/route')) as unknown as {
    POST: (r: Request) => Promise<Response>;
  };
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId, patch }),
    }),
  );
  return { status: res.status, json: (await res.json()) as { error?: { message: string } } };
}

const SCHEDA_COMPLETA = {
  allergeni: 'Glutine, sesamo',
  ingredienti: 'farina di grano tenero, acqua, olio extravergine, sale, lievito, sesamo',
};

beforeEach(() => {
  db.scritture.length = 0;
  db.prodotti = [];
  db.categorie = structuredClone(CATEGORIE);
  db.errore = null;
});

/* --------------------------------- prove ---------------------------------- */

describe('«pubblica» dalla chat passa dagli stessi controlli del modulo', () => {
  it('la focaccia con «Glutine» dedotto e Ingredienti vuoto NON va in vendita', async () => {
    db.prodotti = [bozzaDellaFocaccia({ allergeni: 'Glutine' })];
    const { status, json } = await applica('bozza-focaccia', { status: 'available' });
    expect(db.scritture, 'la focaccia senza ingredienti e stata messa in vendita').toEqual([]);
    expect(status).toBe(400);
    expect(json.error?.message).toContain('Ingredienti');
  });

  it('senza allergeni la risposta dice cosa manca, non «Riprova»', async () => {
    db.prodotti = [bozzaDellaFocaccia({})];
    const { status, json } = await applica('bozza-focaccia', { status: 'available' });
    expect(status).toBe(400);
    expect(json.error?.message).toContain('Allergeni');
    expect(json.error?.message).toContain('Ingredienti');
    expect(json.error?.message).not.toContain('Riprova');
    expect(db.scritture).toEqual([]);
  });

  it('gli altri controlli del modulo valgono anche qui: foto, prezzo, descrizione', async () => {
    db.prodotti = [
      { ...bozzaDellaFocaccia(SCHEDA_COMPLETA), images: [], price: 0, description: 'Buona' },
    ];
    const { status, json } = await applica('bozza-focaccia', { status: 'available' });
    expect(status).toBe(400);
    expect(json.error?.message).toContain('una foto');
    expect(json.error?.message).toContain('Prezzo');
    expect(json.error?.message).toContain('Descrizione');
    expect(db.scritture).toEqual([]);
  });

  it('una scheda completa va in vendita: il controllo non blocca il lavoro buono', async () => {
    db.prodotti = [bozzaDellaFocaccia(SCHEDA_COMPLETA)];
    const { status } = await applica('bozza-focaccia', { status: 'available' });
    expect(status).toBe(200);
    expect(db.scritture).toEqual([{ id: 'bozza-focaccia', valori: { status: 'available' } }]);
  });

  it('spostare fra gli alimentari un prodotto gia in vendita, senza allergeni, non passa', async () => {
    db.prodotti = [
      {
        ...bozzaDellaFocaccia({}),
        id: 'tagliere',
        name: 'Tagliere in legno',
        description: 'Tagliere in legno di ulivo, fatto a mano.',
        category_id: 'casa',
        status: 'available',
      },
    ];
    const { status, json } = await applica('tagliere', { category_slug: 'alimentari' });
    expect(status).toBe(400);
    expect(json.error?.message).toContain('Allergeni');
    expect(db.scritture).toEqual([]);
  });

  it('un ritocco di prezzo su un alimento gia in vendita non viene bloccato', async () => {
    db.prodotti = [{ ...bozzaDellaFocaccia({ allergeni: 'Glutine' }), status: 'available' }];
    const { status } = await applica('bozza-focaccia', { price: 3.8 });
    expect(status).toBe(200);
    expect(db.scritture).toHaveLength(1);
  });
});

describe('il motivo del database arriva al negoziante', () => {
  const MOTIVO =
    'Un prodotto alimentare non si puo pubblicare senza dichiarare gli allergeni. Se non ne contiene nessuno, scrivi «Nessuno dei 14 allergeni».';

  it('un rifiuto 23514 della rotta diventa il suo messaggio, non «Riprova»', async () => {
    db.prodotti = [bozzaDellaFocaccia(SCHEDA_COMPLETA)];
    db.errore = { code: '23514', message: MOTIVO };
    const { status, json } = await applica('bozza-focaccia', { status: 'available' });
    expect(status).toBe(400);
    expect(json.error?.message).toBe(MOTIVO);
  });

  it('un guasto vero resta un guasto: li «Riprova» e onesto', async () => {
    db.prodotti = [bozzaDellaFocaccia(SCHEDA_COMPLETA)];
    db.errore = { code: '08006', message: 'connection failure' };
    const { status, json } = await applica('bozza-focaccia', { status: 'available' });
    expect(status).toBe(502);
    expect(json.error?.message).toContain('Riprova');
  });

  it('il nome tecnico di un vincolo CHECK non arriva al negoziante', () => {
    const esito = erroreDiSalvataggio({
      code: '23514',
      message: 'new row for relation "products" violates check constraint "products_nome_misura"',
    });
    expect(esito.tipo).toBe('regola');
    expect(esito.messaggio).not.toContain('products_nome_misura');
    expect(esito.messaggio).not.toContain('Riprova');
  });
});

describe('il Catalog Copilot, quando mette in vendita', () => {
  it('pubblica la scheda completa e lascia ferma quella senza ingredienti, dicendo perche', async () => {
    db.prodotti = [
      bozzaDellaFocaccia({ allergeni: 'Glutine' }),
      { ...bozzaDellaFocaccia(SCHEDA_COMPLETA), id: 'pizza-bianca', name: 'Pizza bianca' },
    ];
    const { POST } = (await import('@/app/api/ai/catalog-apply-bulk/route')) as unknown as {
      POST: (r: Request) => Promise<Response>;
    };
    const res = await POST(
      new Request('http://localhost/api/ai/catalog-apply-bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          changes: [
            { productId: 'bozza-focaccia', patch: { status: 'available' } },
            { productId: 'pizza-bianca', patch: { status: 'available' } },
          ],
        }),
      }),
    );
    const json = (await res.json()) as {
      applied: number;
      results: { productId: string; ok: boolean; motivo?: string }[];
    };
    expect(json.applied).toBe(1);
    expect(db.scritture.map((s) => s.id)).toEqual(['pizza-bianca']);
    const ferma = json.results.find((r) => r.productId === 'bozza-focaccia');
    expect(ferma?.ok).toBe(false);
    expect(ferma?.motivo).toContain('Ingredienti');
  });
});

describe('la bozza dalle foto: allergeni e ingredienti si vedono e si confermano', () => {
  const dallaFoto = {
    name: 'Focaccia genovese',
    description: "Focaccia genovese all'olio",
    category_slug: 'alimentari',
    suggested_price: 3.5,
    attributes: { allergeni: 'Glutine', peso: '300 g' } as Record<string, string>,
    tags: ['focaccia'],
  };

  it('la scheda della chat mostra cosa ha letto il modello e cosa manca', () => {
    const { lette, obbligatoriVuoti } = dichiarazioniDellaBozza(dallaFoto);
    expect(lette).toEqual([{ chiave: 'allergeni', etichetta: 'Allergeni', valore: 'Glutine' }]);
    expect(obbligatoriVuoti).toEqual(['Ingredienti']);
  });

  it('senza la spunta del negoziante, gli allergeni letti dal modello non entrano nella bozza', () => {
    const insert = buildDraftProductInsert({
      draft: bozzaDaCreare(dallaFoto, false),
      imageUrls: FOTO,
      categories: CATEGORIE,
      sellerId: 'forno-1',
    });
    expect(insert.attributes).not.toHaveProperty('allergeni');
    expect(insert.attributes).toHaveProperty('peso', '300 g'); // il resto della lettura resta
  });

  it('con la spunta entrano, perche li ha visti e confermati lui', () => {
    const insert = buildDraftProductInsert({
      draft: bozzaDaCreare(dallaFoto, true),
      imageUrls: FOTO,
      categories: CATEGORIE,
      sellerId: 'forno-1',
    });
    expect(insert.attributes).toHaveProperty('allergeni', 'Glutine');
  });

  it('dopo la bozza, per un alimento incompleto la chat NON invita a scrivere «pubblica»', () => {
    const riga = { id: 'b', ...buildDraftProductInsert({ draft: dallaFoto, imageUrls: FOTO, categories: CATEGORIE, sellerId: 'forno-1' }), has_variants: false };
    const messaggio = messaggioDopoLaBozza(productSnapshot(riga, CATEGORIE));
    expect(messaggio).not.toContain('"pubblica"');
    expect(messaggio).toContain('Ingredienti');
  });

  it('per una scheda completa l invito a pubblicare resta', () => {
    const riga = {
      id: 'b',
      ...buildDraftProductInsert({
        draft: { ...dallaFoto, attributes: SCHEDA_COMPLETA },
        imageUrls: FOTO,
        categories: CATEGORIE,
        sellerId: 'forno-1',
      }),
      has_variants: false,
    };
    expect(messaggioDopoLaBozza(productSnapshot(riga, CATEGORIE))).toContain('"pubblica"');
  });
});
