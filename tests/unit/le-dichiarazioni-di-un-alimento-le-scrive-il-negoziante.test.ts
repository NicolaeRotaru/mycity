import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAiPatch, patchAiPerIlForm, type CategoryRow } from '@/lib/products/aiPatch';
import { buildCatalogBatchRequests, parseCatalogBatchEntry, senzaCampiEconomici } from '@/lib/ai/catalogBatch';

/**
 * 15/10/2026 (R41) — «MIGLIORA TUTTO IL CATALOGO» SCRIVEVA ALLERGENI INDOVINATI
 * DAL NOME SOPRA QUELLI DEL NEGOZIANTE.
 *
 * Pane Quotidiano ha la «Focaccia» in vendita con gli allergeni scritti a mano:
 * «Glutine, sesamo, latte». Il titolare lancia «Migliora tutto». Il modello
 * vede solo nome e descrizione — niente foto, niente etichetta — e propone
 * `allergeni: "Glutine"`, gli ingredienti di una focaccia qualunque e la
 * casella «Senza lattosio». L'anteprima dice «Modifiche proposte», lui preme
 * «Applica a tutti», e un cliente allergico al latte legge «Senza lattosio».
 *
 * Il risolutore delle modifiche AI scriveva qualunque attributo valido per la
 * categoria. Queste prove guardano cosa arriva DAVVERO alla scrittura nel
 * database, da tutte le strade: il risolutore, il lotto (rotta compresa), la
 * chat Assistenza (rotta), il Catalog Copilot (rotta) e il filtro del modulo.
 */

// L'elenco e' scritto qui per esteso e NON importato: se qualcuno toglie un
// campo dalla lista protetta, questa prova se ne accorge.
const DICHIARAZIONI = [
  'allergeni',
  'ingredienti',
  'valori_nutrizionali',
  'senza_glutine',
  'senza_lattosio',
  'vegano',
  'bio',
  'origine',
  'scadenza',
];

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
];

const DICHIARATO_DAL_NEGOZIANTE: Record<string, string> = {
  allergeni: 'Glutine, sesamo, latte',
  ingredienti: 'farina di grano tenero, acqua, olio, latte, sesamo, sale, lievito',
  valori_nutrizionali: 'Energia 1200 kJ',
  senza_glutine: 'false',
  senza_lattosio: 'false',
  vegano: 'false',
  bio: 'false',
  origine: 'Piacenza',
  scadenza: '2026-10-20',
  marca: 'Pane Quotidiano',
};

const FOCACCIA = {
  id: 'focaccia',
  seller_id: 'forno-1',
  name: 'Focaccia',
  description: 'Focaccia alta, cotta ogni mattina nel nostro forno.',
  price: 3.5,
  compare_at_price: null,
  unit: 'pezzo',
  condition: null,
  stock: 10,
  status: 'available',
  category_id: 'pane',
  images: ['https://example.supabase.co/storage/v1/object/public/products/focaccia.jpg'],
  attributes: { ...DICHIARATO_DAL_NEGOZIANTE },
  tags: ['focaccia'],
  has_variants: false,
};

/* ----------------------------- finto database ----------------------------- */

const db = vi.hoisted(() => ({
  scritture: [] as { tabella: string; id: unknown; valori: Record<string, unknown> }[],
  prodotti: [] as Record<string, unknown>[],
  categorie: [] as Record<string, unknown>[],
  lavoro: null as Record<string, unknown> | null,
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
    if (tabella === 'catalog_ai_jobs') {
      if (s.op === 'update') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: db.lavoro, error: null });
    }
    // products
    if (s.op === 'update') {
      db.scritture.push({ tabella, id: s.filtri.id, valori: s.valori ?? {} });
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

function post(url: string, corpo: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

async function chiama(modulo: string, url: string, corpo: unknown): Promise<Response> {
  const { POST } = (await import(modulo)) as { POST: (r: Request) => Promise<Response> };
  return POST(post(url, corpo));
}

const allergeniScritti = () =>
  db.scritture
    .map((s) => (s.valori.attributes as Record<string, unknown> | undefined)?.allergeni)
    .filter((v) => v !== undefined);

beforeEach(() => {
  db.scritture.length = 0;
  db.prodotti = [structuredClone(FOCACCIA)];
  db.categorie = structuredClone(CATEGORIE);
  db.lavoro = null;
});

/* --------------------------------- prove ---------------------------------- */

describe('il risolutore delle modifiche AI non tocca le dichiarazioni di un alimento', () => {
  it.each(DICHIARAZIONI)('non SCRIVE «%s» sopra quello del negoziante', (chiave) => {
    const { update, protetti } = resolveAiPatch({
      patch: { attributes: { [chiave]: chiave.startsWith('senza') || chiave === 'vegano' || chiave === 'bio' ? 'true' : 'indovinato dal modello' } },
      current: { attributes: { ...DICHIARATO_DAL_NEGOZIANTE }, category_id: 'pane', price: 3.5 },
      categories: CATEGORIE,
    });
    const scritto = (update.attributes as Record<string, unknown> | undefined)?.[chiave];
    expect(scritto ?? DICHIARATO_DAL_NEGOZIANTE[chiave], `l'AI ha riscritto «${chiave}»`).toBe(
      DICHIARATO_DAL_NEGOZIANTE[chiave],
    );
    expect(protetti.length, `«${chiave}» e' stato scartato in silenzio`).toBe(1);
  });

  it.each(DICHIARAZIONI)('non TOGLIE «%s»', (chiave) => {
    const { update } = resolveAiPatch({
      patch: { attributes_remove: [chiave] },
      current: { attributes: { ...DICHIARATO_DAL_NEGOZIANTE }, category_id: 'pane', price: 3.5 },
      categories: CATEGORIE,
    });
    const attributi = (update.attributes as Record<string, unknown> | undefined) ?? DICHIARATO_DAL_NEGOZIANTE;
    expect(attributi[chiave], `l'AI ha cancellato «${chiave}»`).toBe(DICHIARATO_DAL_NEGOZIANTE[chiave]);
  });

  it('nello scenario della focaccia passa solo il testo: allergeni, ingredienti e «senza lattosio» restano quelli del forno', () => {
    const { update, protetti } = resolveAiPatch({
      patch: {
        description: 'Focaccia alta e soffice, cotta ogni mattina nel forno a legna.',
        attributes: {
          allergeni: 'Glutine',
          ingredienti: 'farina, acqua, sale, lievito',
          senza_lattosio: 'true',
          marca: 'Forno Pane Quotidiano',
        },
      },
      current: { attributes: { ...DICHIARATO_DAL_NEGOZIANTE }, category_id: 'pane', price: 3.5 },
      categories: CATEGORIE,
    });
    expect(update.description).toContain('forno a legna');
    expect(update.attributes).toEqual({ ...DICHIARATO_DAL_NEGOZIANTE, marca: 'Forno Pane Quotidiano' });
    expect(protetti).toEqual(['Allergeni', 'Ingredienti', 'Senza lattosio']);
  });

  it('un patch che conteneva solo allergeni non diventa «una modifica»', () => {
    const { update } = resolveAiPatch({
      patch: { attributes: { allergeni: 'Glutine' } },
      current: { attributes: { ...DICHIARATO_DAL_NEGOZIANTE }, category_id: 'pane', price: 3.5 },
      categories: CATEGORIE,
    });
    expect(Object.keys(update)).toEqual([]);
  });
});

describe('il lavoro massivo «Migliora tutto»', () => {
  it('il risultato del modello esce dal lotto senza dichiarazioni', () => {
    const esito = parseCatalogBatchEntry('improve', {
      customId: 'focaccia',
      status: 'succeeded',
      toolInput: {
        summary: 'Aggiunti allergeni e ingredienti',
        patch: {
          description: 'Focaccia alta e soffice.',
          attributes: { allergeni: 'Glutine', senza_lattosio: 'true', marca: 'Forno' },
          attributes_remove: ['ingredienti'],
        },
      },
    } as never);
    expect(esito.patch).toEqual({ description: 'Focaccia alta e soffice.', attributes: { marca: 'Forno' } });
  });

  it('un risultato fatto solo di allergeni non conta come «modifica proposta»', () => {
    expect(senzaCampiEconomici({ attributes: { allergeni: 'Glutine' } })).toEqual({});
  });

  it('al modello non si chiede di compilare le dichiarazioni', () => {
    const [richiesta] = buildCatalogBatchRequests({
      operation: 'improve',
      products: [FOCACCIA as never],
      categories: CATEGORIE,
    });
    const testo = JSON.stringify(richiesta.messages[0].content);
    const elenco = testo.slice(testo.indexOf('Attributi validi per la categoria'));
    expect(elenco).toContain('- marca (');
    for (const chiave of DICHIARAZIONI) expect(elenco).not.toContain(`- ${chiave} (`);
  });

  it('la ROTTA che applica il lotto non scrive gli allergeni di un risultato vecchio', async () => {
    // Un lavoro salvato prima della correzione: il patch ha ancora dentro le
    // dichiarazioni. «Applica a tutti» non deve scriverle.
    db.lavoro = {
      id: 'job-1',
      seller_id: 'forno-1',
      operation: 'improve',
      status: 'ready',
      results: [
        {
          product_id: 'focaccia',
          patch: {
            description: 'Focaccia alta e soffice, cotta ogni mattina.',
            attributes: { allergeni: 'Glutine', ingredienti: 'farina, acqua', senza_lattosio: 'true' },
          },
        },
      ],
    };
    const res = await chiama('@/app/api/ai/catalog-batch/apply/route', '/api/ai/catalog-batch/apply', {
      jobId: 'job-1',
    });
    expect(res.status).toBe(200);
    const prodotti = db.scritture.filter((s) => s.tabella === 'products');
    expect(prodotti).toHaveLength(1);
    expect(prodotti[0].valori.description).toContain('cotta ogni mattina');
    const attributi = prodotti[0].valori.attributes as Record<string, unknown> | undefined;
    expect(attributi?.allergeni ?? FOCACCIA.attributes.allergeni).toBe('Glutine, sesamo, latte');
    expect(attributi?.senza_lattosio ?? FOCACCIA.attributes.senza_lattosio).toBe('false');
  });
});

describe('le altre strade che scrivono nel database', () => {
  it('la chat Assistenza: «metti allergeni glutine» non si scrive e dice dove si fa', async () => {
    const res = await chiama('@/app/api/ai/catalog-apply/route', '/api/ai/catalog-apply', {
      productId: 'focaccia',
      patch: { attributes: { allergeni: 'Glutine' } },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toContain('Allergeni');
    expect(allergeniScritti()).toEqual([]);
  });

  it('il Catalog Copilot: togliere gli allergeni a un prodotto non si scrive', async () => {
    const res = await chiama('@/app/api/ai/catalog-apply-bulk/route', '/api/ai/catalog-apply-bulk', {
      changes: [{ productId: 'focaccia', patch: { attributes_remove: ['allergeni', 'ingredienti'] } }],
    });
    const json = (await res.json()) as { applied: number; results: { ok: boolean; motivo?: string }[] };
    expect(json.applied).toBe(0);
    expect(json.results[0].ok).toBe(false);
    expect(db.scritture).toEqual([]);
  });

  it('il modulo («migliora», chat del prodotto, voce): la proposta si vede ma non entra nei campi', () => {
    const { patch, rifiutati } = patchAiPerIlForm(
      {
        price: 3.6,
        attributes: { allergeni: 'Glutine', marca: 'Forno' },
        attributes_remove: ['ingredienti'],
      },
      { prezzoAttuale: 3.5 },
    );
    expect(patch).toEqual({ price: 3.6, attributes: { marca: 'Forno' } });
    expect(rifiutati.join(' | ')).toContain('Glutine'); // il valore proposto resta leggibile
    expect(rifiutati).toHaveLength(2);
  });

  it('il modulo: la banda sul prezzo continua a valere insieme al nuovo filtro', () => {
    const { patch, rifiutati } = patchAiPerIlForm(
      { price: 0.35, attributes: { vegano: 'true' } },
      { prezzoAttuale: 3.5 },
    );
    expect(patch).toEqual({});
    expect(rifiutati).toHaveLength(2);
  });
});
