/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * ⑤ LA PAGINA DELL'AGENTE PASSA DA SOLA A «ADESSO TOCCA A SDG» — 27/11/2026.
 *
 * Nicola, 17:25: quando il titolare conferma dal link, la pagina dove l'agente ha creato il link «deve aggiornarsi e
 * portarlo alla pagina con su scritto tutte le cose che deve fare adesso SDG». Dopo il «Sì, aggiungi» il riquadro
 * chiede ogni 10 secondi a /api/agente/attivita; appena il preventivo è «accettato» porta a /agente/tocca-a-sdg.
 * Solo con la scheda visibile, e smette dopo 30 minuti.
 */
const { default: AggiungiAttivita, CONTROLLA_OGNI_MS, SMETTI_DOPO_MS } = await import('@/components/agenti/AggiungiAttivita');

const LAVORO = '11111111-2222-4333-8444-555555555555';
let root: Root | null = null;
let visibile = 'visible';
const risposte: { stato?: string; status?: number }[] = [];
const domande: string[] = [];
const andato: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  visibile = 'visible';
  risposte.length = 0;
  domande.length = 0;
  andato.length = 0;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibile });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/agente/aggiungi') {
      return new Response(JSON.stringify({ ok: true, data: { nome: 'Caffè di Prova', nuova: true, link: 'https://www.mycity-marketplace.com/preventivo/abc', avvisato: true, fascia: 'business', sbloccata: true, giaOnline: false } }), { status: 201 });
    }
    domande.push(url);
    const r = risposte.shift() ?? { stato: 'aperto' };
    return new Response(JSON.stringify(r.status === 404 ? { ok: false, error: { message: 'Nessuna attività' } } : { ok: true, data: { stato: r.stato } }), { status: r.status ?? 200 });
  }));
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.useRealTimers(); });

async function dopoIlSi() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
  await act(async () => { root!.render(createElement(AggiungiAttivita, { lavoro: LAVORO, nome: 'Caffè di Prova', consigliato: 'business', vai: (u: string) => { andato.push(u); } })); });
  const bottone = (t: string) => [...radice.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement;
  await act(async () => { bottone('Aggiungi attività').click(); });
  await act(async () => { (radice.querySelector('input[value="business"]') as HTMLInputElement).click(); });
  await act(async () => { (radice.querySelector('input[type="checkbox"][value="sito_web"]') as HTMLInputElement).click(); });
  await act(async () => { bottone('Sì, aggiungi').click(); });
  return radice;
}
const avanti = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('⑤ dopo il «Sì» la pagina passa da sola a «Adesso tocca a SDG»', () => {
  it('chiede ogni 10 secondi; quando il preventivo è accettato porta l agente alla pagina di SDG', async () => {
    const r = await dopoIlSi();
    expect(r.textContent).toContain('Controllo da solo, ogni 10 secondi');
    expect(domande).toHaveLength(0);
    risposte.push({ stato: 'aperto' }, { stato: 'accettato' });
    await avanti(CONTROLLA_OGNI_MS);
    expect(domande).toEqual([`/api/agente/attivita?lavoro=${LAVORO}`]);
    expect(andato).toEqual([]);
    await avanti(CONTROLLA_OGNI_MS);
    expect(domande).toHaveLength(2);
    expect(andato).toEqual([`/agente/tocca-a-sdg?lavoro=${LAVORO}`]);
    expect(r.textContent).toContain('Il titolare ha confermato');
    // Dopo la conferma non chiede più.
    await avanti(CONTROLLA_OGNI_MS * 3);
    expect(domande).toHaveLength(2);
  });

  it('con la scheda nascosta non chiede; quando torna visibile riprende', async () => {
    await dopoIlSi();
    visibile = 'hidden';
    await avanti(CONTROLLA_OGNI_MS * 5);
    expect(domande).toHaveLength(0);
    visibile = 'visible';
    risposte.push({ stato: 'accettato' });
    await avanti(CONTROLLA_OGNI_MS);
    expect(domande).toHaveLength(1);
    expect(andato).toHaveLength(1);
  });

  it('smette dopo 30 minuti, e lo dice', async () => {
    const r = await dopoIlSi();
    await avanti(SMETTI_DOPO_MS + CONTROLLA_OGNI_MS);
    const fatte = domande.length;
    expect(fatte).toBeGreaterThan(100);
    expect(fatte).toBeLessThanOrEqual(SMETTI_DOPO_MS / CONTROLLA_OGNI_MS);
    expect(r.textContent).toContain('Ho smesso di controllare');
    await avanti(CONTROLLA_OGNI_MS * 10);
    expect(domande.length).toBe(fatte);
    expect(andato).toEqual([]);
  });

  it('ogni 10 secondi, per 30 minuti: i numeri sono quelli chiesti', () => {
    expect(CONTROLLA_OGNI_MS).toBe(10_000);
    expect(SMETTI_DOPO_MS).toBe(30 * 60_000);
  });

  it('tre risposte «non c è» DI FILA e si ferma, e lo dice; un preventivo chiuso si dice', async () => {
    const r = await dopoIlSi();
    // Due «non c'è», poi una risposta buona: il conto riparte.
    risposte.push({ status: 404 }, { status: 404 }, { stato: 'aperto' }, { status: 404 }, { status: 404 }, { status: 404 });
    await avanti(CONTROLLA_OGNI_MS * 5);
    expect(domande).toHaveLength(5);
    expect(r.textContent).not.toContain('Non trovo più');
    await avanti(CONTROLLA_OGNI_MS * 4);
    expect(domande).toHaveLength(6);
    expect(r.textContent).toContain('Non trovo più questa attività fra le tue');
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    const r2 = await dopoIlSi();
    risposte.push({ stato: 'chiuso' });
    await avanti(CONTROLLA_OGNI_MS);
    expect(r2.textContent).toContain('Questo preventivo è stato chiuso');
    expect(andato).toEqual([]);
  });
});

describe('«Adesso tocca a SDG» aspetta che l ordine arrivi (collaudo del 27/11)', () => {
  it('se il titolare ha appena confermato e l ordine non c è ancora, richiede finché arriva', async () => {
    const { default: Pagina } = await import('@/app/agente/tocca-a-sdg/page');
    window.history.replaceState(null, '', `/agente/tocca-a-sdg?lavoro=${LAVORO}`);
    const base = { stato: 'accettato', nome: 'Caffè di Prova', fascia: 'business', accettatoIl: '2026-11-27T16:25:00Z', visitaIl: null, visita: 'Visita: da fissare col titolare', link: null };
    const passi = [{ titolo: 'La visita del team creativo', testo: 'x' }];
    const lette: unknown[] = [{ ...base, ordine: null, passi }, { ...base, ordine: null, passi }, { ...base, ordine: { pianoOrigine: 'sito', pianoStato: 'in_corso', contenuti: 12, periodo: 'dal 30 novembre al 27 dicembre 2026' }, passi }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: lette.shift() ?? lette.at(-1) }), { status: 200 })));
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    root = createRoot(radice);
    await act(async () => { root!.render(createElement(Pagina)); });
    await avanti(0);
    expect(radice.textContent).toContain('aspetto che l’ordine arrivi a SDG');
    expect(radice.textContent).not.toContain('La visita del team creativo');
    await avanti(3000);
    expect(radice.textContent).toContain('aspetto che l’ordine arrivi a SDG');
    await avanti(3000);
    expect(radice.textContent).toContain('La visita del team creativo');
    expect(radice.textContent).toContain('L’ordine è arrivato a SDG');
  });
});
