/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * LA PAGINA DELLA MAPPA DEI CLIENTI — 28/11/2026. Le due viste: la mappa (qui finta: Leaflet non gira in jsdom) e la
 * lista ordinabile, di serie per priorità. «Ci vado io» manda la richiesta giusta e aggiorna la riga; un cliente
 * preso da un altro non mostra né «Ci vado io» né i pulsanti dello stato.
 */
vi.mock('next/dynamic', () => ({ default: () => () => createElement('div', { 'data-prova': 'mappa' }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: unknown }) => createElement('a', { href }, children as never) }));

const { default: Pagina } = await import('@/app/agente/clienti/page');

const cl = (osm: string, nome: string, punteggio: number, extra: Record<string, unknown> = {}) => ({
  osm, nome, tipo: 'bar', segmento: null, indirizzo: 'Via Roma 1', telefono: '0523 111222', sito: null, lat: 45.05, lon: 9.69, distanzaM: 100,
  punteggio, perche: 'bar e ristoranti', offerta: 'sito', mappa: 'https://www.google.com/maps/search/?api=1&query=x', dossier: null, settimana: null,
  inFila: true, stato: 'da_visitare', presa: 'libera', ...extra,
});

let root: Root | null = null;
const chiamate: { metodo: string; corpo: unknown }[] = [];
let div: HTMLDivElement;

beforeEach(() => {
  chiamate.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const corpo = init?.body ? JSON.parse(String(init.body)) : null;
    chiamate.push({ metodo, corpo });
    if (metodo === 'POST') return new Response(JSON.stringify({ ok: true, data: cl(corpo.osm, 'Bar Basso', 40, { presa: 'mia' }) }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, data: { admin: false, clienti: [cl('node/1', 'Bar Basso', 40), cl('node/2', 'Forno Alto', 90), cl('node/3', 'Fiori Presi', 60, { presa: 'altro' })] } }), { status: 200 });
  }));
  div = document.createElement('div');
  document.body.appendChild(div);
});
afterEach(() => { act(() => root?.unmount()); root = null; div.remove(); vi.unstubAllGlobals(); });

const testo = () => div.textContent ?? '';
const bottone = (t: string) => [...div.querySelectorAll('button')].find((b) => b.textContent?.trim() === t || b.textContent?.includes(t));

describe('la pagina della mappa dei clienti', () => {
  it('apre sulla mappa; la lista è in ordine di priorità', async () => {
    await act(async () => { root = createRoot(div); root.render(createElement(Pagina)); });
    expect(div.querySelector('[data-prova="mappa"]')).not.toBeNull();
    expect(testo()).toContain('3 attività · 2 libere · 0 tue');
    await act(async () => { bottone('Lista')!.click(); });
    const nomi = [...div.querySelectorAll('ol li span.block.truncate.font-semibold')].map((s) => s.textContent);
    expect(nomi).toEqual(['Forno Alto', 'Fiori Presi', 'Bar Basso']);
  });
  it('«Ci vado io» manda la richiesta giusta e la riga diventa mia', async () => {
    await act(async () => { root = createRoot(div); root.render(createElement(Pagina)); });
    await act(async () => { bottone('Lista')!.click(); });
    await act(async () => { bottone('Bar Basso')!.click(); });
    expect(testo()).toContain('Chiama 0523 111222');
    expect(div.querySelector('a[href="tel:0523111222"]')).not.toBeNull();
    await act(async () => { bottone('Ci vado io')!.click(); });
    expect(chiamate.at(-1)).toEqual({ metodo: 'POST', corpo: { osm: 'node/1', azione: 'prendi' } });
    expect(testo()).toContain('0 tue'.replace('0', '1'));
    expect(bottone('Lascio')).toBeTruthy();
    expect(bottone('iscritta')).toBeTruthy();
  });
  it('un cliente preso da un altro: niente «Ci vado io» e niente stato', async () => {
    await act(async () => { root = createRoot(div); root.render(createElement(Pagina)); });
    await act(async () => { bottone('Lista')!.click(); });
    await act(async () => { bottone('Fiori Presi')!.click(); });
    expect(testo()).toContain('L’ha presa un altro agente');
    expect(bottone('Ci vado io')).toBeUndefined();
    expect(bottone('iscritta')).toBeUndefined();
  });
});

describe('il segnaposto della mappa', () => {
  it('ha l icona, il colore dello stato e un nome leggibile, senza lasciar passare HTML dal nome', async () => {
    const { htmlSegnaposto } = await import('@/components/agenti/MappaClienti');
    const h = htmlSegnaposto('Bar "<b>Sole</b>"', 'ristoro', 'mia', false);
    expect(h).toContain('aria-label="Bar &quot;&lt;b&gt;Sole&lt;/b&gt;&quot;: bar e ristoranti, presa da me"');
    expect(h).toContain('background:#C0492C');
    expect(h).toContain('<svg');
    expect(h).not.toContain('<b>');
  });
});
