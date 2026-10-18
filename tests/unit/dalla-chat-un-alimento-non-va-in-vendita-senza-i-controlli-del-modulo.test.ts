import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDraftProductInsert } from '@/lib/products/draftFromVision';
import { productSnapshot } from '@/lib/products/aiSnapshot';
import {
  avvisoDopoLeBozze,
  avvisoSullaPubblicazione,
  bozzaDaCreare,
  dichiarazioniDellaBozza,
  erroreDiSalvataggio,
  messaggioDaCompletare,
  messaggioDopoLaBozza,
  motivoDaCompletare,
  riquadroDichiarazioni,
} from '@/lib/products/prontoPerLaVendita';
import { CAMPI_DICHIARATIVI, messaggioDichiarazioniProtette, type CategoryRow } from '@/lib/products/aiPatch';
import { findLabelForKey } from '@/lib/category-attributes';
import { avvisoDopoLApplicazione } from '@/lib/ai/esitoCopilot';
import { apiErrorMessage, friendlyError } from '@/lib/errors';

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

/**
 * La bozza che la chat crea dalla foto di una focaccia, come nella scheda R36.
 * Qui le dichiarazioni sono passate dalla spunta del negoziante: queste prove
 * guardano cosa succede DOPO, quando la bozza va messa in vendita.
 */
function bozzaDellaFocaccia(attributi: Record<string, string>) {
  const insert = buildDraftProductInsert({
    draft: {
      name: 'Focaccia genovese',
      description: "Focaccia genovese all'olio", // 26 caratteri, come nello scenario
      category_slug: 'alimentari',
      suggested_price: 3.5,
      attributes: attributi,
      tags: ['focaccia', 'pane'],
      dichiarazioni_confermate: true,
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
  inserite: [] as Record<string, unknown>[],
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
  type Stato = {
    op: 'select' | 'update' | 'insert';
    valori: Record<string, unknown> | Record<string, unknown>[] | null;
    filtri: Record<string, unknown>;
  };
  const risolvi = (tabella: string, s: Stato, una: boolean) => {
    if (tabella === 'categories') return Promise.resolve({ data: db.categorie, error: null });
    if (s.op === 'insert') {
      // Le bozze nascono nel finto database come ci nascerebbero davvero.
      const righe = (Array.isArray(s.valori) ? s.valori : [s.valori ?? {}]).map((v) => ({
        id: `nuovo-${db.prodotti.length}`,
        has_variants: false,
        ...v,
      }));
      for (const r of righe) {
        db.prodotti.push(r);
        db.inserite.push(r);
      }
      return Promise.resolve({ data: una ? righe[0] : righe, error: null });
    }
    if (s.op === 'update') {
      if (db.errore) return Promise.resolve({ data: null, error: db.errore });
      const valori = (s.valori ?? {}) as Record<string, unknown>;
      db.scritture.push({ id: s.filtri.id, valori });
      const riga = db.prodotti.find((p) => p.id === s.filtri.id);
      return Promise.resolve({ data: { ...riga, ...valori }, error: null });
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
      insert: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        s.op = 'insert';
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

/** Quello che il negoziante legge nella chat: lo stesso giro che fa SupportProductAssistant. */
const comeLoLeggeLaChat = (json: unknown) => friendlyError(new Error(apiErrorMessage(json, 'Errore')));

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
  db.inserite.length = 0;
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

  it('nel caso peggiore il negoziante legge ancora l elenco intero, non un messaggio generico', async () => {
    db.prodotti = [
      { ...bozzaDellaFocaccia({}), images: [], price: 0, description: '', name: 'F', category_id: 'alim' },
    ];
    const { json } = await applica('bozza-focaccia', { status: 'available' });
    const letto = comeLoLeggeLaChat(json);
    for (const campo of ['una foto', 'Nome', 'Descrizione', 'Prezzo', 'Allergeni', 'Ingredienti']) {
      expect(letto, `nella chat si legge: ${letto}`).toContain(campo);
    }
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

    // 16/10/2026 — La scheda della proposta lo dice PRIMA di Applica, con la
    // regola e la frase del server: prima taceva, e il rifiuto diceva «Per
    // metterlo in vendita manca» a chi l'aveva gia' in vendita.
    const scheda = productSnapshot(db.prodotti[0] as never, CATEGORIE);
    const avviso = avvisoSullaPubblicazione(scheda, { category_slug: 'alimentari' });
    expect(avviso?.mancanti, 'la scheda della proposta non avvisa').toEqual(['Allergeni', 'Ingredienti']);
    expect(avviso?.categoriaNuova).toBe('alimentari');
    expect(comeLoLeggeLaChat(json)).toBe(messaggioDaCompletare(avviso!.mancanti, avviso!.categoriaNuova));
    expect(comeLoLeggeLaChat(json)).not.toContain('metterlo in vendita');
    // Il Copilot, che applica in blocco, dice lo stesso perche'.
    const blocco = await chiama('@/app/api/ai/catalog-apply-bulk/route', '/api/ai/catalog-apply-bulk', {
      changes: [{ productId: 'tagliere', patch: { category_slug: 'alimentari' } }],
    });
    const esiti = blocco.json.results as { ok: boolean; motivo?: string }[];
    expect(esiti[0]).toEqual({ productId: 'tagliere', ok: false, motivo: motivoDaCompletare(['Allergeni', 'Ingredienti']) });
    expect(esiti[0].motivo).not.toContain('metterlo in vendita');
    expect(db.scritture).toEqual([]);
  });

  it('la stessa regola, sulla scheda e sul server: ogni caso dice la stessa cosa', async () => {
    const tagliere = {
      ...bozzaDellaFocaccia({}),
      id: 'tagliere',
      name: 'Tagliere in legno',
      description: 'Tagliere in legno di ulivo, fatto a mano.',
      category_id: 'casa',
      status: 'available',
    };
    const casi: { prodotto: Record<string, unknown>; patch: Record<string, unknown> }[] = [
      // In vendita, spostato fra gli alimentari: si ferma, sulla scheda e sul server.
      { prodotto: tagliere, patch: { category_slug: 'alimentari' } },
      // In vendita, stessa categoria di primo livello: passa, e la scheda tace.
      { prodotto: { ...bozzaDellaFocaccia({}), status: 'available' }, patch: { category_slug: 'alimentari', subcategory_name: 'Pane e forno' } },
      // In vendita, un ritocco di prezzo: passa, e la scheda tace.
      { prodotto: tagliere, patch: { price: 3.8 } },
      // Una bozza da mettere in vendita senza allergeni: si ferma.
      { prodotto: bozzaDellaFocaccia({}), patch: { status: 'available' } },
      // Una bozza completa da mettere in vendita: passa.
      { prodotto: bozzaDellaFocaccia(SCHEDA_COMPLETA), patch: { status: 'available' } },
    ];
    const stati: number[] = [];
    for (const { prodotto, patch } of casi) {
      db.prodotti = [prodotto];
      db.scritture = [];
      const avviso = avvisoSullaPubblicazione(productSnapshot(prodotto as never, CATEGORIE), patch);
      const { status, json } = await applica(String(prodotto.id), patch);
      stati.push(status);
      const mancanti = avviso?.mancanti ?? [];
      if (mancanti.length > 0) {
        expect(status, JSON.stringify(patch)).toBe(400);
        expect(comeLoLeggeLaChat(json), JSON.stringify(patch)).toBe(
          messaggioDaCompletare(mancanti, avviso?.categoriaNuova ?? null),
        );
      } else {
        expect(status, `${JSON.stringify(patch)}: ${json.error?.message}`).toBe(200);
      }
    }
    // Le due strade ci sono tutte e due: la prova non gira a vuoto.
    expect(stati).toEqual([400, 200, 200, 400, 200]);
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
    expect(comeLoLeggeLaChat(json)).toBe(MOTIVO);
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
        draft: { ...dallaFoto, attributes: SCHEDA_COMPLETA, dichiarazioni_confermate: true },
        imageUrls: FOTO,
        categories: CATEGORIE,
        sellerId: 'forno-1',
      }),
      has_variants: false,
    };
    expect(messaggioDopoLaBozza(productSnapshot(riga, CATEGORIE))).toContain('"pubblica"');
  });
});

/* ------------------------------------------------------------------------- */
/*  Collaudo del 15/10: il percorso intero, partendo da «Crea più prodotti»   */
/* ------------------------------------------------------------------------- */

type Rotta = { POST: (r: Request) => Promise<Response> };

async function chiama(rotta: string, url: string, corpo: unknown) {
  const { POST } = (await import(rotta)) as unknown as Rotta;
  const res = await POST(
    new Request(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> & { error?: { message: string } } };
}

/** Quello che il modello legge sulla foto della focaccia, senza nessuna etichetta. */
const FOCACCIA_LETTA = {
  name: 'Focaccia genovese',
  description: "Focaccia genovese all'olio, alta e morbida",
  category_slug: 'alimentari',
  suggested_price: 3.5,
  attributes: { allergeni: 'Glutine', ingredienti: 'farina, acqua, olio, sale, lievito', peso: '300 g' },
  tags: ['focaccia'],
};
const FOTO_NOSTRA = 'https://abcdefgh.supabase.co/storage/v1/object/public/products/forno-1/focaccia.jpg';

describe('«Crea più prodotti dalle foto», poi «pubblica»: il percorso intero', () => {
  it('senza la spunta la bozza nasce SENZA allergeni e ingredienti, e «pubblica» si ferma', async () => {
    // Il corpo che la schermata mandava prima: le dichiarazioni del modello, nessuna conferma.
    const creata = await chiama('@/app/api/ai/catalog-create-bulk/route', '/api/ai/catalog-create-bulk', {
      items: [{ imageUrls: [FOTO_NOSTRA], draft: FOCACCIA_LETTA }],
    });
    expect(creata.status).toBe(200);
    expect(db.inserite).toHaveLength(1);
    const attributi = db.inserite[0].attributes as Record<string, string>;
    expect(attributi, 'la bozza e nata con allergeni che nessuno ha visto').not.toHaveProperty('allergeni');
    expect(attributi).not.toHaveProperty('ingredienti');
    expect(attributi).toHaveProperty('peso', '300 g');

    // Dalla chat: «pubblica».
    const dallaChat = await applica('nuovo-0', { status: 'available' });
    expect(dallaChat.status).toBe(400);
    expect(comeLoLeggeLaChat(dallaChat.json)).toContain('Allergeni');
    expect(comeLoLeggeLaChat(dallaChat.json)).toContain('Ingredienti');

    // Dal Copilot: «pubblica tutte le bozze».
    const dalCopilot = await chiama('@/app/api/ai/catalog-apply-bulk/route', '/api/ai/catalog-apply-bulk', {
      changes: [{ productId: 'nuovo-0', patch: { status: 'available' } }],
    });
    expect(dalCopilot.json.applied).toBe(0);
    expect(db.scritture, 'la focaccia e andata in vendita').toEqual([]);
  });

  it('con la spunta le dichiarazioni entrano: il negoziante le ha viste e confermate', async () => {
    const creata = await chiama('@/app/api/ai/catalog-create-bulk/route', '/api/ai/catalog-create-bulk', {
      items: [{ imageUrls: [FOTO_NOSTRA], draft: { ...FOCACCIA_LETTA, dichiarazioni_confermate: true } }],
    });
    expect(creata.status).toBe(200);
    expect(db.inserite[0].attributes).toMatchObject({ allergeni: 'Glutine', ingredienti: 'farina, acqua, olio, sale, lievito' });
    const pubblicata = await applica('nuovo-0', { status: 'available' });
    expect(pubblicata.status).toBe(200);
  });

  it('la rotta della chat (un prodotto) ha la stessa porta: senza spunta, niente dichiarazioni', async () => {
    const senza = await chiama('@/app/api/ai/catalog-create/route', '/api/ai/catalog-create', {
      imageUrls: [FOTO_NOSTRA],
      draft: FOCACCIA_LETTA,
    });
    expect(senza.status).toBe(200);
    expect(db.inserite[0].attributes).not.toHaveProperty('allergeni');
    expect(db.inserite[0].attributes).not.toHaveProperty('ingredienti');

    const con = await chiama('@/app/api/ai/catalog-create/route', '/api/ai/catalog-create', {
      imageUrls: [FOTO_NOSTRA],
      draft: { ...FOCACCIA_LETTA, dichiarazioni_confermate: true },
    });
    expect(con.status).toBe(200);
    expect(db.inserite[1].attributes).toHaveProperty('allergeni', 'Glutine');
  });

  it('la spunta deve essere un sì vero: un testo «true» non vale', async () => {
    const r = await chiama('@/app/api/ai/catalog-create-bulk/route', '/api/ai/catalog-create-bulk', {
      items: [{ imageUrls: [FOTO_NOSTRA], draft: { ...FOCACCIA_LETTA, dichiarazioni_confermate: 'true' } }],
    });
    // O la rotta rifiuta la richiesta, o la bozza nasce senza: mai con le dichiarazioni.
    const conDichiarazioni = db.inserite.some((p) => 'allergeni' in (p.attributes as Record<string, string>));
    expect(conDichiarazioni, `stato ${r.status}`).toBe(false);
  });

  it('il Copilot dice al negoziante QUALE prodotto e fermo e PERCHE', async () => {
    db.prodotti = [bozzaDellaFocaccia({ allergeni: 'Glutine' })];
    const { json } = await chiama('@/app/api/ai/catalog-apply-bulk/route', '/api/ai/catalog-apply-bulk', {
      changes: [{ productId: 'bozza-focaccia', patch: { status: 'available' } }],
    });
    const avviso = avvisoDopoLApplicazione({ applied: json.applied, results: json.results }, [
      { product_id: 'bozza-focaccia', name: 'Focaccia genovese' },
    ]);
    expect(avviso.tipo).toBe('avviso');
    expect(avviso.testo).toContain('Focaccia genovese');
    expect(avviso.testo).toContain('Ingredienti');
  });
});

describe('collaudo del 15/10: i casi che nessuna prova teneva', () => {
  it('un alimento esaurito rimesso in vendita senza ingredienti si ferma', async () => {
    db.prodotti = [{ ...bozzaDellaFocaccia({ allergeni: 'Glutine' }), status: 'sold' }];
    const { status, json } = await applica('bozza-focaccia', { status: 'available' });
    expect(status).toBe(400);
    expect(json.error?.message).toContain('Ingredienti');
    expect(db.scritture).toEqual([]);
  });

  it('spostare dentro gli alimentari un alimento gia in vendita non butta via le migliorie', async () => {
    db.prodotti = [{ ...bozzaDellaFocaccia({}), status: 'available', category_id: 'alim' }];
    const { status } = await applica('bozza-focaccia', {
      description: 'Focaccia genovese alta e morbida, del forno',
      category_slug: 'alimentari',
      subcategory_name: 'Pane e forno',
    });
    expect(status).toBe(200);
    expect(db.scritture[0].valori).toMatchObject({
      description: 'Focaccia genovese alta e morbida, del forno',
      category_id: 'pane',
    });
  });

  it('se l assistente propone tutti e nove i campi protetti, il motivo arriva intero, non «Riprova»', async () => {
    db.prodotti = [bozzaDellaFocaccia(SCHEDA_COMPLETA)];
    const tutti = Object.fromEntries(CAMPI_DICHIARATIVI.map((k) => [k, 'x']));
    const { status, json } = await applica('bozza-focaccia', { attributes: tutti });
    expect(status).toBe(400);
    const letto = comeLoLeggeLaChat(json);
    expect(letto).not.toContain('Riprova');
    expect(letto).toContain('Allergeni');
    expect(letto).toContain("non li cambia l'assistente");
  });

  it('con qualunque numero di campi protetti il messaggio passa intero dalla chat', () => {
    const etichette = CAMPI_DICHIARATIVI.map((k) => findLabelForKey(k));
    for (let n = 1; n <= etichette.length; n++) {
      const messaggio = messaggioDichiarazioniProtette(etichette.slice(0, n));
      expect(friendlyError(new Error(messaggio)), `con ${n} campi`).toBe(messaggio);
    }
  });
});

describe('la scheda della chat dice quello che dira il server', () => {
  const SCHEDA_LIBRO = {
    name: 'Il nome della rosa',
    description: 'Romanzo',
    price: 12,
    categorySlug: 'libri',
    attributes: {},
    image: 'https://abcdefgh.supabase.co/x.jpg',
    status: 'draft',
  };

  it('una descrizione corretta nella stessa proposta non e piu «mancante»', () => {
    const avviso = avvisoSullaPubblicazione(SCHEDA_LIBRO, {
      description: 'Romanzo di Umberto Eco, edizione tascabile Bompiani',
      status: 'available',
    });
    expect(avviso?.mancanti).toEqual([]);
  });

  it('allergeni proposti dall assistente non riempiono la scheda: l avviso resta', () => {
    const avviso = avvisoSullaPubblicazione(
      { ...SCHEDA_LIBRO, name: 'Focaccia', description: "Focaccia genovese all'olio", categorySlug: 'alimentari' },
      { attributes: { allergeni: 'Glutine', ingredienti: 'farina' }, status: 'available' },
    );
    expect(avviso?.mancanti).toEqual(['Allergeni', 'Ingredienti']);
  });

  it('un alimento completo mostra le dichiarazioni con cui andrebbe in vetrina', () => {
    const avviso = avvisoSullaPubblicazione(
      {
        ...SCHEDA_LIBRO,
        name: 'Focaccia',
        description: "Focaccia genovese all'olio",
        categorySlug: 'alimentari',
        attributes: { ...SCHEDA_COMPLETA, senza_glutine: 'false', vegano: 'true' },
      },
      { status: 'available' },
    );
    expect(avviso?.mancanti).toEqual([]);
    expect(avviso?.dichiarazioni).toEqual([
      { etichetta: 'Vegano', valore: 'Sì' },
      { etichetta: 'Allergeni', valore: 'Glutine, sesamo' },
      { etichetta: 'Ingredienti', valore: SCHEDA_COMPLETA.ingredienti },
    ]);
  });

  it('una proposta che non mette in vendita non mostra niente', () => {
    expect(avvisoSullaPubblicazione(SCHEDA_LIBRO, { price: 13 })).toBeNull();
  });
});

describe('il riquadro della bozza dice il vero prima e dopo la creazione', () => {
  const draft = {
    category_slug: 'alimentari',
    attributes: { allergeni: 'Glutine', senza_glutine: 'false', peso: '300 g' },
  };

  it('prima: mostra cosa ha letto il modello e chiede la spunta', () => {
    const r = riquadroDichiarazioni(draft, { creata: false, confermate: false });
    expect(r?.righe).toEqual([{ etichetta: 'Allergeni', valore: 'Glutine' }]);
    expect(r?.chiediSpunta).toBe(true);
    expect(r?.daScrivere).toContain('Ingredienti');
  });

  /** La bozza come la salva il server, passando dalla porta vera. */
  function salvata(confermate: boolean) {
    const riga = {
      id: 'b',
      ...buildDraftProductInsert({
        draft: bozzaDaCreare(draft, confermate),
        imageUrls: FOTO,
        categories: CATEGORIE,
        sellerId: 'forno-1',
      }),
      has_variants: false,
    };
    const { categorySlug, attributes } = productSnapshot(riga, CATEGORIE);
    return { categorySlug, attributes };
  }

  it('dopo, senza spunta: dice che NON sono entrate e che manca anche l allergene', () => {
    const r = riquadroDichiarazioni(draft, { creata: true, confermate: false, salvata: salvata(false) });
    expect(r?.titolo).toContain('NON entrate');
    expect(r?.daScrivere).toContain('Allergeni, Ingredienti');
    expect(r?.chiediSpunta).toBe(false);
  });

  it('dopo, con la spunta: dice che sono entrate', () => {
    const r = riquadroDichiarazioni(draft, { creata: true, confermate: true, salvata: salvata(true) });
    expect(r?.titolo).toContain('Entrate');
    expect(r?.daScrivere).toContain('Ingredienti');
    expect(r?.daScrivere).not.toContain('Allergeni');
  });

  it('dopo «Crea più prodotti» si dice subito quali bozze vanno completate', () => {
    const testo = avvisoDopoLeBozze([
      { name: 'Focaccia', description: '', price: 3.5, categorySlug: 'alimentari', attributes: {}, image: null },
      { name: 'Tagliere', description: '', price: 20, categorySlug: 'casa', attributes: {}, image: null },
    ]);
    expect(testo).toContain('«Focaccia» (Allergeni, Ingredienti)');
    expect(testo).not.toContain('Tagliere');
  });
});
