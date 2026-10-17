/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';

/**
 * 16/10/2026 (giro di correzione) — «APPLICATO A 1 PRODOTTI SU 1», E IL SESAMO
 * NON C'ERA.
 *
 * Il fornaio ha la «Focaccia genovese» in vendita fra gli alimentari, con gli
 * allergeni «Glutine». Cambia ricetta e scrive al Catalog Copilot «aggiungi
 * sesamo agli allergeni delle focacce e mettile col tag novita'». Il Copilot
 * propone il tag e gli allergeni «Glutine, sesamo». Lui preme «Applica tutte».
 *
 * Gli allergeni non entrano — le dichiarazioni le scrive il negoziante (R41) —
 * e questo e' giusto. Ma la rotta lo diceva solo quando nella modifica non
 * c'era nient'altro: insieme al tag, il tag si scriveva, l'esito era «ok»
 * senza una parola, e l'avviso diceva «Applicato a 1 prodotti su 1.» col
 * bollino verde «Applicato.». In vetrina gli allergeni restavano «Glutine», e
 * lui credeva di aver dichiarato il sesamo.
 *
 * Qui girano la rotta vera, l'avviso vero e lo schermo vero del Copilot. Il
 * database e' finto. Nessuna lettura delle parole: si guarda cosa e' stato
 * scritto e cosa dice lo schermo.
 *
 * Nella stessa rotta (minore): quando il database rifiuta due prodotti, il
 * motivo del guardiano degli allergeni finisce gia' con un punto, e l'avviso
 * mostrava «».;» fra i due e «»..» in fondo.
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
  erroreDiScrittura: null as { code: string; message: string } | null,
}));

const avvisi = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => 'avviso'),
    dismiss: vi.fn(),
  }),
}));
vi.mock('sonner', () => ({ toast: avvisi.toast, Toaster: () => null }));

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
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return {
    ...actual,
    classifyProductPolicy: async () => ({ allowed: true }),
    assertSafeText: async () => undefined,
  };
});
const runMessageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});
vi.mock('@/lib/supabase/server', async () => {
  const { fintoCatalogo } = await import('./aiuti/finto-catalogo');
  return fintoCatalogo(db);
});

import { avvisoDopoLApplicazione } from '@/lib/ai/esitoCopilot';
import { fraseSulleDichiarazioni } from '@/lib/products/avvisoDellaDettatura';
import { REGOLA_CAMPI_DICHIARATIVI } from '@/lib/products/aiPatch';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/** La frase fissa della dettatura, per i soli allergeni. */
const FRASE_ALLERGENI =
  "Allergeni non li scrive l'assistente: se li hai detti, scrivili tu nella scheda prima di salvare.";

const FOCACCIA = {
  id: 'foc',
  seller_id: 'forno-1',
  name: 'Focaccia genovese',
  description: "Focaccia genovese all'olio, alta e morbida.",
  price: 3.5,
  compare_at_price: null,
  unit: 'pezzo',
  condition: null,
  stock: 10,
  status: 'available',
  category_id: 'pane',
  images: ['https://mycity.test/focaccia.jpg'],
  attributes: { allergeni: 'Glutine', ingredienti: 'farina, acqua, olio, sale, lievito', marca: 'Forno' },
  tags: ['focaccia'],
  has_variants: false,
};
const TORTA = { ...FOCACCIA, id: 'torta', name: 'Torta di riso', attributes: {} };
const SEGALE = { ...FOCACCIA, id: 'segale', name: 'Pane di segale', attributes: {} };

const NOMI = [
  { product_id: 'foc', name: 'Focaccia genovese' },
  { product_id: 'torta', name: 'Torta di riso' },
  { product_id: 'segale', name: 'Pane di segale' },
];

/** Il messaggio del guardiano degli allergeni, com'e' scritto nella migrazione 126. */
const RIFIUTO_DEL_GUARDIANO = {
  code: '23514',
  message:
    'Un prodotto alimentare non si puo pubblicare senza dichiarare gli allergeni. Se non ne contiene nessuno, scrivi «Nessuno dei 14 allergeni».',
};

async function applicaInBlocco(changes: { productId: string; patch: Record<string, unknown> }[]) {
  const { POST } = (await import('@/app/api/ai/catalog-apply-bulk/route')) as unknown as {
    POST: (r: Request) => Promise<Response>;
  };
  return POST(
    new Request('http://localhost/api/ai/catalog-apply-bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes }),
    }),
  );
}

async function esitoDi(changes: { productId: string; patch: Record<string, unknown> }[]) {
  const res = await applicaInBlocco(changes);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { applied: number; results: Record<string, unknown>[] };
  const nomi = NOMI.filter((n) => changes.some((c) => c.productId === n.product_id));
  return { json, avviso: avvisoDopoLApplicazione(json, nomi) };
}

const attributiScritti = () =>
  db.scritture.flatMap((s) => (s.valori.attributes ? [s.valori.attributes as Record<string, unknown>] : []));

beforeEach(() => {
  vi.clearAllMocks();
  db.prodotti = [{ ...FOCACCIA }, { ...TORTA }, { ...SEGALE }];
  db.scritture = [];
  db.erroreDiScrittura = null;
});

describe('il Copilot in blocco: un allergene chiesto insieme ad altro non diventa «Applicato»', () => {
  it('tag + allergeni: si scrive il tag, e l avviso dice che gli allergeni NON sono entrati, con la frase fissa', async () => {
    const { json, avviso } = await esitoDi([
      { productId: 'foc', patch: { tags: ['focaccia', 'novita'], attributes: { allergeni: 'Glutine, sesamo' } } },
    ]);
    // Il tag entra, la dichiarazione no: la macchina non la scrive mai.
    expect(db.scritture).toEqual([{ id: 'foc', valori: { tags: ['focaccia', 'novita'] } }]);
    expect(json.applied).toBe(1);
    expect(json.results[0], 'l esito e «ok» senza una parola sugli allergeni lasciati fuori').toEqual({
      productId: 'foc',
      ok: true,
      nonApplicato: FRASE_ALLERGENI,
    });
    expect(avviso.tipo, 'il Copilot dice «successo» con il sesamo rimasto fuori').toBe('avviso');
    expect(avviso.testo).not.toContain('Applicato a 1 prodotti su 1');
    expect(avviso.testo).toBe(
      "Applicate 1 modifiche su 1, ma 1 non per intero: «Focaccia genovese»: Allergeni non li scrive l'assistente: se li hai detti, scrivili tu nella scheda prima di salvare.",
    );
  });

  it('la frase e quella della dettatura, anche col solo allergene (prodotto fermo)', async () => {
    const { json, avviso } = await esitoDi([{ productId: 'foc', patch: { attributes: { allergeni: 'Glutine, sesamo' } } }]);
    expect(db.scritture).toEqual([]);
    expect(json.results[0]).toEqual({ productId: 'foc', ok: false, motivo: fraseSulleDichiarazioni(['Allergeni']) });
    expect(avviso.tipo).toBe('avviso');
    expect(avviso.testo).toContain('Ferme: «Focaccia genovese»: Allergeni non li scrive l');
  });

  it('tag + allergeni + marca: entrano tag e marca, gli allergeni restano quelli di prima e l avviso lo dice', async () => {
    const { json, avviso } = await esitoDi([
      {
        productId: 'foc',
        patch: { tags: ['novita'], attributes: { allergeni: 'Glutine, sesamo', marca: 'Forno Rossi' } },
      },
    ]);
    expect(attributiScritti()).toEqual([{ ...FOCACCIA.attributes, marca: 'Forno Rossi' }]);
    expect(json.results[0]).toMatchObject({ ok: true, nonApplicato: FRASE_ALLERGENI });
    expect(avviso.tipo).toBe('avviso');
  });

  it('controprova: una modifica entrata tutta resta «Applicato a 1 prodotti su 1»', async () => {
    const { json, avviso } = await esitoDi([{ productId: 'foc', patch: { tags: ['focaccia', 'novita'] } }]);
    expect(json.results[0]).toEqual({ productId: 'foc', ok: true });
    expect(avviso).toEqual({ tipo: 'successo', testo: 'Applicato a 1 prodotti su 1.' });
  });

  it('il modello del Copilot riceve la regola delle dichiarazioni, come le altre strade', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { reply: 'Ho preparato 1 modifica.', changes: [] } });
    const { POST } = (await import('@/app/api/ai/copilot/route')) as unknown as {
      POST: (r: Request) => Promise<Response>;
    };
    const res = await POST(
      new Request('http://localhost/api/ai/copilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'aggiungi sesamo agli allergeni delle focacce' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(runMessageMock).toHaveBeenCalledTimes(1);
    const chiamata = runMessageMock.mock.calls[0][0] as { system: string };
    expect(chiamata.system).toContain(REGOLA_CAMPI_DICHIARATIVI);
    vi.unstubAllEnvs();
  });
});

describe('quando il database rifiuta, la punteggiatura dell avviso non raddoppia', () => {
  it('due prodotti fermi dal guardiano degli allergeni: niente «».;» ne «»..»', async () => {
    db.erroreDiScrittura = RIFIUTO_DEL_GUARDIANO;
    const { avviso } = await esitoDi([
      { productId: 'torta', patch: { attributes: { marca: 'Forno Rossi' } } },
      { productId: 'segale', patch: { attributes: { marca: 'Forno Rossi' } } },
    ]);
    expect(avviso.testo).toContain('«Torta di riso»: Un prodotto alimentare');
    expect(avviso.testo).toContain('«Pane di segale»: Un prodotto alimentare');
    expect(avviso.testo, avviso.testo).not.toMatch(/\.;/);
    expect(avviso.testo, avviso.testo).not.toMatch(/\.\.$/);
    expect(avviso.testo.endsWith('«Nessuno dei 14 allergeni».')).toBe(true);
  });

  it('il messaggio tecnico di un vincolo, e un solo prodotto: un punto solo in fondo', async () => {
    db.erroreDiScrittura = { code: '23514', message: 'new row violates check constraint "products_name_len"' };
    const { avviso } = await esitoDi([{ productId: 'torta', patch: { attributes: { marca: 'Forno Rossi' } } }]);
    expect(avviso.testo.endsWith('controllala.'), avviso.testo).toBe(true);
    expect(avviso.testo, avviso.testo).not.toMatch(/\.\.$/);
  });

  it('una scritta solo in parte e una ferma insieme: due frasi, ognuna col suo punto', async () => {
    const { avviso } = await esitoDi([
      { productId: 'foc', patch: { tags: ['novita'], attributes: { allergeni: 'Glutine, sesamo' } } },
      // La torta: la modifica e' fatta solo di allergeni, quindi resta ferma.
      { productId: 'torta', patch: { attributes: { allergeni: 'Glutine' } } },
    ]);
    expect(avviso.testo).toContain('Applicate 1 modifiche su 2, ma 1 non per intero: «Focaccia genovese»:');
    expect(avviso.testo).toContain('. Ferme: «Torta di riso»: Allergeni non li scrive');
    expect(avviso.testo, avviso.testo).not.toMatch(/\.;|\.\.|;\./);
  });
});

/* ------------------------------------------------------------------------- */
/*  Lo schermo del Copilot                                                    */
/* ------------------------------------------------------------------------- */

describe('lo schermo del Copilot: «Applicato.» col segno verde solo se e entrato tutto', () => {
  let Copilot: ComponentType<Record<string, unknown>>;
  beforeAll(async () => {
    Copilot = (await monta('components/seller/CatalogCopilot.tsx')).default as ComponentType<Record<string, unknown>>;
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  }, 60000);

  beforeEach(() => {
    const g = globalThis as Record<string, unknown>;
    g.__UTENTE__ = { id: 'forno-1' };
    g.__GETTONE__ = 'gettone-di-prova';
  });
  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g.__UTENTE__;
    delete g.__GETTONE__;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  /** Il fornaio scrive l'istruzione, il Copilot propone `patch`, lui preme «Applica tutte». */
  async function applicaDalloSchermo(patch: Record<string, unknown>) {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url) === '/api/ai/copilot') {
        const dati = {
          reply: 'Ho preparato 1 modifica.',
          changes: [{ product_id: 'foc', name: 'Focaccia genovese', patch }],
        };
        return { ok: true, status: 200, json: async () => dati } as unknown as Response;
      }
      if (String(url) === '/api/ai/catalog-apply-bulk') {
        // La rotta vera, col database finto.
        const corpo = JSON.parse(String(init?.body)) as { changes: { productId: string; patch: Record<string, unknown> }[] };
        return applicaInBlocco(corpo.changes);
      }
      throw new Error(`chiamata inattesa: ${url}`);
    });
    const s = accendi(Copilot);
    const area = s.radice.querySelector('textarea') as HTMLTextAreaElement;
    s.agisci(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(
        area,
        'aggiungi sesamo agli allergeni delle focacce e mettile col tag novita',
      );
      area.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    s.agisci(() => clicca(s.radice.querySelector('button[aria-label="Invia al copilot"]')!));
    for (let i = 0; i < 12; i++) await attendi();
    const applica = Array.from(s.radice.querySelectorAll('button')).find((b) =>
      testoVisibile(b).includes('Applica tutte'),
    );
    expect(applica, `il pulsante «Applica tutte» non e a video: ${testoVisibile(s.radice)}`).toBeTruthy();
    s.agisci(() => clicca(applica!));
    for (let i = 0; i < 12; i++) await attendi();
    return s;
  }

  it('tag + allergeni: niente «Applicato.» verde, e resta scritto cosa non e entrato', async () => {
    const s = await applicaDalloSchermo({ tags: ['focaccia', 'novita'], attributes: { allergeni: 'Glutine, sesamo' } });
    expect(db.scritture, 'la prova non e arrivata alla rotta').toHaveLength(1);
    const testo = testoVisibile(s.radice);
    expect(testo, 'il bollino «Applicato.» dice che e entrato tutto').not.toContain('Applicato.');
    expect(testo).toContain(FRASE_ALLERGENI.replace(/\.$/, ''));
    expect(avvisi.toast.success, 'l avviso verde «Applicato a 1 prodotti su 1»').not.toHaveBeenCalled();
    expect(avvisi.toast.warning).toHaveBeenCalledTimes(1);
    s.smonta();
  });

  it('controprova: il solo tag entra tutto, e il bollino «Applicato.» c e', async () => {
    const s = await applicaDalloSchermo({ tags: ['focaccia', 'novita'] });
    expect(db.scritture).toHaveLength(1);
    expect(testoVisibile(s.radice)).toContain('Applicato.');
    expect(avvisi.toast.success).toHaveBeenCalledWith('Applicato a 1 prodotti su 1.');
    s.smonta();
  });
});
