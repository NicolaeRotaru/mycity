/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';

/**
 * R10-002 — Il copilot del catalogo rimanda SOLO le voci rimaste fuori.
 *
 * La rotta in blocco lascia fuori le voci non controllate o non scritte in tempo, col motivo
 * «… in tempo: rimandalo», e le elenca in `rimaste` (gli id dei prodotti che non ha toccato).
 * Lo schermo leggeva solo applied/results e toglieva «Applica tutte»: l'unica strada era
 * richiedere al copilot, che riproponeva tutto, e con «-10% sul prezzo» le voci già scritte
 * si riscontavano. Qui lo schermo vero del Copilot, con la rete finta: si guarda cosa parte
 * verso la rotta quando si preme il rimando.
 */
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

import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

type Voce = { productId: string; patch: Record<string, unknown> };
type Risposta = Record<string, unknown>;

const PROPOSTA = [
  { product_id: 'a', name: 'Salame', patch: { price: 9 } },
  { product_id: 'b', name: 'Coppa', patch: { price: 13.5 } },
  { product_id: 'c', name: 'Pancetta', patch: { price: 7.2 } },
];
const ok = (id: string) => ({ productId: id, ok: true });
const fuori = (id: string, motivo = 'non salvato in tempo: rimandalo') => ({ productId: id, ok: false, motivo });

let Copilot: ComponentType<Record<string, unknown>>;
beforeAll(async () => {
  Copilot = (await monta('components/seller/CatalogCopilot.tsx')).default as ComponentType<Record<string, unknown>>;
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
}, 60000);

/** Le richieste partite verso la rotta in blocco, in ordine. */
let inviate: Voce[][] = [];

beforeEach(() => {
  vi.clearAllMocks();
  inviate = [];
  const g = globalThis as Record<string, unknown>;
  g.__UTENTE__ = { id: 'negozio-1' };
  g.__GETTONE__ = 'gettone-di-prova';
});
afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__UTENTE__;
  delete g.__GETTONE__;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** La rete finta: il copilot propone PROPOSTA, la rotta in blocco risponde in fila con `risposte`. */
function rete(risposte: Risposta[]) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url) === '/api/ai/copilot') {
      const dati = { reply: 'Ho preparato 3 modifiche.', changes: PROPOSTA };
      return { ok: true, status: 200, json: async () => dati } as unknown as Response;
    }
    if (String(url) === '/api/ai/catalog-apply-bulk') {
      inviate.push((JSON.parse(String(init?.body)) as { changes: Voce[] }).changes);
      const dati = risposte.shift() ?? { ok: true, applied: 0, results: [] };
      return { ok: true, status: 200, json: async () => dati } as unknown as Response;
    }
    throw new Error(`chiamata inattesa: ${url}`);
  });
}

const pulsante = (radice: HTMLElement, testo: RegExp) =>
  Array.from(radice.querySelectorAll('button')).find((b) => testo.test(testoVisibile(b)));
const aspetta = async () => { for (let i = 0; i < 12; i++) await attendi(); };

/** Chiede al copilot, preme «Applica tutte» e torna lo schermo. */
async function applicaTutte() {
  const s = accendi(Copilot);
  const area = s.radice.querySelector('textarea') as HTMLTextAreaElement;
  s.agisci(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(area, 'alza i salumi');
    area.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  s.agisci(() => clicca(s.radice.querySelector('button[aria-label="Invia al copilot"]')!));
  await aspetta();
  const applica = pulsante(s.radice, /Applica tutte/);
  expect(applica, `«Applica tutte» non è a video: ${testoVisibile(s.radice)}`).toBeTruthy();
  s.agisci(() => clicca(applica!));
  await aspetta();
  expect(inviate, 'controprova: «Applica tutte» manda tutta la proposta').toEqual([
    PROPOSTA.map((c) => ({ productId: c.product_id, patch: c.patch })),
  ]);
  return s;
}

const PRIMA_RISPOSTA = {
  ok: true,
  applied: 1,
  total: 3,
  results: [ok('a'), fuori('b', 'non controllato in tempo: rimandalo'), fuori('c')],
  rimaste: ['b', 'c'],
};

describe('R10-002 — le voci rimaste fuori si rimandano da sole', () => {
  it('il rimando manda solo le rimaste, con le stesse modifiche proposte, e mai quella già scritta', async () => {
    rete([PRIMA_RISPOSTA, { ok: true, applied: 2, total: 2, results: [ok('b'), ok('c')] }]);
    const s = await applicaTutte();
    const rimanda = pulsante(s.radice, /Rimanda/);
    expect(rimanda, `nessun modo di rimandare le rimaste: ${testoVisibile(s.radice)}`).toBeTruthy();
    expect(testoVisibile(rimanda!)).toContain('2');
    s.agisci(() => clicca(rimanda!));
    await aspetta();
    expect(inviate).toHaveLength(2);
    expect(inviate[1]).toEqual([
      { productId: 'b', patch: { price: 13.5 } },
      { productId: 'c', patch: { price: 7.2 } },
    ]);
    // Entrate anche le rimaste: tutte e tre, e il rimando sparisce.
    expect(pulsante(s.radice, /Rimanda/)).toBeUndefined();
    expect(testoVisibile(s.radice)).toContain('Applicato.');
    expect(avvisi.toast.success).toHaveBeenLastCalledWith('Applicato a 3 prodotti su 3.');
    s.smonta();
  });

  it('un doppio clic sul rimando manda una richiesta sola', async () => {
    rete([PRIMA_RISPOSTA, { ok: true, applied: 2, total: 2, results: [ok('b'), ok('c')] }]);
    const s = await applicaTutte();
    const rimanda = pulsante(s.radice, /Rimanda/);
    expect(rimanda, testoVisibile(s.radice)).toBeTruthy();
    s.agisci(() => { clicca(rimanda!); clicca(rimanda!); });
    await aspetta();
    expect(inviate, 'il secondo clic ha rimandato le stesse voci').toHaveLength(2);
    s.smonta();
  });

  it('se al rimando ne resta fuori ancora una, il rimando dopo manda solo quella', async () => {
    rete([
      PRIMA_RISPOSTA,
      { ok: true, applied: 1, total: 2, results: [ok('b'), fuori('c')], rimaste: ['c'] },
      { ok: true, applied: 1, total: 1, results: [ok('c')] },
    ]);
    const s = await applicaTutte();
    s.agisci(() => clicca(pulsante(s.radice, /Rimanda/)!));
    await aspetta();
    const ancora = pulsante(s.radice, /Rimanda/);
    expect(ancora, testoVisibile(s.radice)).toBeTruthy();
    expect(testoVisibile(ancora!)).toMatch(/la voce rimasta fuori/);
    expect(testoVisibile(s.radice)).toContain('Applicate 2 modifiche su 3');
    s.agisci(() => clicca(ancora!));
    await aspetta();
    expect(inviate.map((v) => v.map((c) => c.productId))).toEqual([['a', 'b', 'c'], ['b', 'c'], ['c']]);
    expect(testoVisibile(s.radice)).toContain('Applicato.');
    s.smonta();
  });

  it('una voce che la risposta dà già scritta non si rimanda, anche se compare fra le rimaste', async () => {
    rete([{ ...PRIMA_RISPOSTA, rimaste: ['a', 'b', 'c'] }, { ok: true, applied: 2, results: [ok('b'), ok('c')] }]);
    const s = await applicaTutte();
    const rimanda = pulsante(s.radice, /Rimanda/);
    expect(rimanda, testoVisibile(s.radice)).toBeTruthy();
    expect(testoVisibile(rimanda!)).toContain('2');
    s.agisci(() => clicca(rimanda!));
    await aspetta();
    expect(inviate[1].map((c) => c.productId)).toEqual(['b', 'c']);
    s.smonta();
  });

  it('controprova: senza voci rimaste fuori (ferme per altri motivi) non compare nessun rimando', async () => {
    rete([{ ok: true, applied: 2, total: 3, results: [ok('a'), ok('b'), fuori('c', 'non è un tuo prodotto')] }]);
    const s = await applicaTutte();
    expect(pulsante(s.radice, /Rimanda/)).toBeUndefined();
    expect(pulsante(s.radice, /Applica tutte/)).toBeUndefined();
    expect(testoVisibile(s.radice)).toContain('Ferme: «Pancetta»: non è un tuo prodotto');
    s.smonta();
  });
});
