import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 16/10/2026 — «LO SCRIVI TU NELLA SCHEDA», PER UN CAMPO CHE LA SCHEDA NON HA.
 *
 * Un vaso blu della categoria Casa. Nella chat Assistenza il modello propone,
 * contro le regole, il nome «Vaso blu cobalto» e l'origine «Italia». La scheda
 * della proposta dice giusto: «la scheda di questo prodotto non ha il campo
 * Origine». Il negoziante preme Applica, e il server rispondeva «Origine NON
 * compilato dall'assistente: lo scrivi tu nella scheda»; con la sola origine,
 * «Li scrivi tu nella scheda del prodotto, col pulsante «Apri»». Lui apriva la
 * scheda, e il campo non c'era. Lo stesso nel riquadro «Da controllare» del
 * modulo, con il solo pulsante «Ho capito».
 *
 * Adesso una dichiarazione per un campo che la scheda non ha esce dalla
 * proposta senza dire niente, come ogni altro attributo che la categoria non
 * ha: sul server, nel modulo, e nelle rotte che le usano. Quelle della scheda
 * — gli allergeni di una focaccia — si dicono come prima.
 */

const db = vi.hoisted(() => ({
  prodotti: [] as Record<string, unknown>[],
  categorie: [
    { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
    { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
    { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
  ] as Record<string, unknown>[],
  lavoro: null as Record<string, unknown> | null,
  lavoroApplicato: 0,
  scritture: [] as { id: unknown; valori: Record<string, unknown> }[],
}));

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) =>
      h({ user: { id: 'negozio-1' }, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
vi.mock('@/lib/ai/moderation', () => ({ classifyProductPolicy: async () => ({ allowed: true }) }));
vi.mock('@/lib/supabase/server', async () => {
  const { fintoCatalogo } = await import('./aiuti/finto-catalogo');
  return fintoCatalogo(db);
});

import {
  esitoDelPiano,
  pianoPatchPerIlModulo,
  resolveAiPatch,
  type AiProductPatch,
  type CategoryRow,
} from '@/lib/products/aiPatch';
import { righeDellaProposta } from '@/lib/products/prontoPerLaVendita';

const CATEGORIE = db.categorie as unknown as CategoryRow[];

const RIGA = {
  seller_id: 'negozio-1',
  compare_at_price: null,
  unit: 'pezzo',
  condition: null,
  stock: 3,
  status: 'available',
  images: ['https://mycity.test/foto.jpg'],
  tags: [],
  has_variants: false,
};
const VASO = {
  ...RIGA,
  id: 'vaso',
  name: 'Vaso blu',
  description: 'Un vaso blu in ceramica, fatto a mano.',
  price: 20,
  category_id: 'casa',
  attributes: { materiale: 'Ceramica' },
};
const FOCACCIA = {
  ...RIGA,
  id: 'focaccia',
  name: 'Focaccia',
  description: "Focaccia genovese all'olio, alta e morbida.",
  price: 3.5,
  category_id: 'pane',
  attributes: { allergeni: 'Glutine', ingredienti: 'farina, acqua, olio, sale' },
};

const risolvi = (riga: typeof VASO | typeof FOCACCIA, patch: AiProductPatch) =>
  resolveAiPatch({
    patch,
    current: { attributes: riga.attributes, category_id: riga.category_id, has_variants: false, price: riga.price },
    categories: CATEGORIE,
  });
const piano = (riga: typeof VASO | typeof FOCACCIA, patch: AiProductPatch) =>
  pianoPatchPerIlModulo(patch, {
    prezzoAttuale: riga.price,
    categorie: CATEGORIE,
    categoriaAttuale: riga.category_id,
    modo: 'edit',
  });

const NOME_E_ORIGINE: AiProductPatch = { name: 'Vaso blu cobalto', attributes: { origine: 'Italia' } };

describe('sul server: la dichiarazione che la scheda non ha non diventa un «lo scrivi tu»', () => {
  it('il vaso: si scrive il nome, e dell origine non si dice niente', () => {
    const r = risolvi(VASO, NOME_E_ORIGINE);
    expect(r.update).toEqual({ name: 'Vaso blu cobalto' });
    expect(r.changed).toEqual(['nome']);
    expect(r.protetti).toEqual([]);
  });

  it('il vaso, con la sola origine: niente da scrivere, e niente da chiedere', () => {
    const r = risolvi(VASO, { attributes: { origine: 'Italia' }, attributes_remove: ['Origine'] });
    expect(r.update).toEqual({});
    expect(r.changed).toEqual([]);
    expect(r.protetti).toEqual([]);
  });

  it('controprova: la focaccia l origine ce l ha, e il server lo dice come prima', () => {
    const r = risolvi(FOCACCIA, { name: 'Focaccia alta', attributes: { origine: 'Liguria' } });
    expect(r.update).toEqual({ name: 'Focaccia alta' });
    expect(r.protetti).toEqual(['Origine']);
    expect(r.changed[0]).toContain('Origine NON compilato');
  });

  it('conta la categoria DOPO la proposta, nei due versi', () => {
    // Il vaso spostato fra gli alimentari: adesso la scheda l'origine ce l'ha.
    expect(risolvi(VASO, { category_slug: 'alimentari', attributes: { origine: 'Italia' } }).protetti).toEqual([
      'Origine',
    ]);
    // La focaccia spostata in Casa: la scheda gli allergeni non li ha piu'.
    const via = risolvi(FOCACCIA, { category_slug: 'casa', attributes: { allergeni: 'Glutine, sesamo' } });
    expect(via.protetti).toEqual([]);
    expect(via.changed).toEqual(['categoria']);
  });

  it('la scheda della proposta e il server dicono la stessa cosa', () => {
    const riga = righeDellaProposta(NOME_E_ORIGINE, { price: 20, categorySlug: 'casa' });
    expect(riga).toContain('Origine → «Italia»: NON si applica, e la scheda di questo prodotto non ha il campo Origine');
    expect(risolvi(VASO, NOME_E_ORIGINE).changed.join(' | ')).not.toContain('scheda');
  });
});

describe('nel modulo: il riquadro «Da controllare» non chiede un campo che non c e', () => {
  it('il vaso: nessuna riga, e niente da rivedere', () => {
    const p = piano(VASO, NOME_E_ORIGINE);
    expect(p.cambiati).toEqual(['nome']);
    expect(p.daControllare).toEqual([]);
    expect(p.daRivedere).toEqual({});
    expect(esitoDelPiano(piano(VASO, { attributes: { origine: 'Italia' } })).inSospeso).toBe(0);
  });

  it('controprova: la focaccia ha la riga, col pulsante per usare il valore', () => {
    const p = piano(FOCACCIA, { attributes: { origine: 'Liguria' } });
    expect(p.daControllare).toEqual([
      expect.objectContaining({ id: 'proposta:origine', chiave: 'origine', valore: 'Liguria' }),
    ]);
  });
});

async function chiama(rotta: string, url: string, corpo: unknown) {
  const { POST } = (await import(rotta)) as unknown as { POST: (r: Request) => Promise<Response> };
  const res = await POST(
    new Request(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> & { error?: { message: string } } };
}

describe('le rotte vere', () => {
  beforeEach(() => {
    db.prodotti = [{ ...VASO }, { ...FOCACCIA }];
    db.scritture = [];
  });

  it('chat Assistenza, Applica sul vaso: scrive il nome e non manda nessun avviso sull origine', async () => {
    const { status, json } = await chiama('@/app/api/ai/catalog-apply/route', '/api/ai/catalog-apply', {
      productId: 'vaso',
      patch: NOME_E_ORIGINE,
    });
    expect(status).toBe(200);
    expect(json.changed).toEqual(['nome']);
    expect(db.scritture).toEqual([{ id: 'vaso', valori: { name: 'Vaso blu cobalto' } }]);
  });

  it('chat Assistenza, la sola origine sul vaso: non rimanda alla scheda col pulsante «Apri»', async () => {
    const { status, json } = await chiama('@/app/api/ai/catalog-apply/route', '/api/ai/catalog-apply', {
      productId: 'vaso',
      patch: { attributes: { origine: 'Italia' } },
    });
    expect(status).toBe(400);
    expect(json.error?.message).toBe('Nessuna modifica valida da applicare.');
    expect(db.scritture).toEqual([]);
  });

  it('il Copilot in blocco: il vaso non dice «li scrivi tu», la focaccia si', async () => {
    const { json } = await chiama('@/app/api/ai/catalog-apply-bulk/route', '/api/ai/catalog-apply-bulk', {
      changes: [
        { productId: 'vaso', patch: { attributes: { origine: 'Italia' } } },
        { productId: 'focaccia', patch: { attributes: { allergeni: 'Glutine, sesamo' } } },
      ],
    });
    expect(json.results).toEqual([
      { productId: 'vaso', ok: false, motivo: 'nessuna modifica valida' },
      {
        productId: 'focaccia',
        ok: false,
        // La frase fissa della dettatura (giro di correzione del 16/10).
        motivo: "Allergeni non li scrive l'assistente: se li hai detti, scrivili tu nella scheda prima di salvare.",
      },
    ]);
    expect(db.scritture).toEqual([]);
  });
});
