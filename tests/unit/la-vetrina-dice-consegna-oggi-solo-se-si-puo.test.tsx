// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 30/10/2026 — LA VETRINA DICE «CONSEGNA OGGI» SOLO SE OGGI UNA CONSEGNA SI PUÒ ANCORA FARE.
 *
 * Il caso vero: giovedì 29/10 alle 20:15 la vetrina di Pane Quotidiano diceva insieme «Chiuso ora»
 * e «Consegna oggi». Il forno aveva chiuso alle 13. Il bollino guardava solo se oggi il negozio
 * aveva un orario, non se la cassa poteva ancora consegnare.
 *
 * La regola è quella della cassa (registro dei fatti, consegna.promessa):
 *   · una fascia di oggi conta se non è finita e il negozio è aperto nella parte che resta
 *     (`fasceAncoraPossibili` + `negozioPuoServire`, le stesse delle rotte che creano l'ordine);
 *   · la veloce conta solo se /api/consegna/veloce ha detto sì (8-21, negozio aperto, fattorino);
 *   · dopo, si dice quello che la cassa offrirà: «Consegna domani», se domani c'è una fascia aperta.
 * L'ora si legge nel browser: nell'HTML del server il bollino non c'è.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: () => {}, push: () => {} }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/StoreStoryRing', () => ({ default: ({ children }: { children?: ReactNode }) => children ?? null }));
vi.mock('@/components/StoreMediaCarousel', () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Pane Quotidiano: il giovedì chiude alle 13, il venerdì riapre la mattina. */
const FORNO = {
  mon: [['07:00', '13:00'], ['16:00', '19:30']],
  tue: [['07:00', '13:00'], ['16:00', '19:30']],
  wed: [['07:00', '13:00'], ['16:00', '19:30']],
  thu: [['07:00', '13:00']],
  fri: [['07:00', '13:00'], ['16:00', '19:30']],
  sat: [['07:00', '13:00']],
};

/** Ottobre 2026 a Piacenza è ancora ora legale fino al 25, poi solare: il 29 è UTC+1. */
function orologioA(utc: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(utc));
}

function cassaDice(possibile: boolean | 'cade') {
  const chiamate: string[] = [];
  vi.stubGlobal('fetch', async (url: unknown) => {
    chiamate.push(String(url));
    if (possibile === 'cade') throw new Error('rete caduta');
    return { ok: true, json: async () => ({ possibile }) };
  });
  return chiamate;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function ctx(orari: unknown) {
  return {
    storeId: 'pane-quotidiano',
    store: { id: 'pane-quotidiano', store_name: 'Pane Quotidiano', store_hours: orari, store_media: [], store_address: 'Via Roma 1, Piacenza' },
    customization: {},
    accent: '#7C8B5A',
    reviews: [],
    promos: [],
    theme: 'classico',
    site: { sections: [] },
  };
}

async function vetrinaNelBrowser(orari: unknown): Promise<string> {
  const { default: HeroSection } = await import('@/components/store-sections/HeroSection');
  const nodo = document.createElement('div');
  document.body.appendChild(nodo);
  const radice = createRoot(nodo);
  await act(async () => {
    radice.render(createElement(HeroSection as never, { config: {}, ctx: ctx(orari) }));
  });
  // La risposta della cassa arriva dopo il primo disegno.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const testo = nodo.textContent ?? '';
  await act(async () => radice.unmount());
  return testo;
}

describe('la vetrina del negozio e la consegna di oggi', () => {
  it('IL CASO VERO — giovedì 29/10 alle 20:15, forno chiuso dalle 13: niente «Consegna oggi», dice domani', async () => {
    orologioA('2026-10-29T19:15:00Z');
    cassaDice(false);
    const t = await vetrinaNelBrowser(FORNO);
    expect(t).toContain('Chiuso ora');
    expect(t).not.toContain('Consegna oggi');
    expect(t).toContain('Consegna domani');
  });

  it('alle 20:15 non chiede nemmeno alla cassa della veloce: a negozio chiuso non può dire sì', async () => {
    orologioA('2026-10-29T19:15:00Z');
    const chiamate = cassaDice(true);
    const t = await vetrinaNelBrowser(FORNO);
    expect(t).not.toContain('Consegna oggi');
    expect(chiamate).toEqual([]);
  });

  it('giovedì alle 9, forno aperto e la cassa dice sì alla veloce: «Consegna oggi»', async () => {
    orologioA('2026-10-29T08:00:00Z');
    const chiamate = cassaDice(true);
    const t = await vetrinaNelBrowser(FORNO);
    expect(t).toContain('Aperto ora');
    expect(t).toContain('Consegna oggi');
    expect(chiamate.join(' ')).toContain('/api/consegna/veloce?negozi=pane-quotidiano');
  });

  it('mercoledì alle 9, il forno riapre alle 16: la fascia 15-18 si può, «Consegna oggi» anche senza veloce', async () => {
    orologioA('2026-10-28T08:00:00Z');
    cassaDice('cade');
    const t = await vetrinaNelBrowser(FORNO);
    expect(t).toContain('Consegna oggi');
  });

  it('giovedì alle 9 senza fattorino: le fasce del pomeriggio cadono a forno chiuso, niente «oggi»', async () => {
    orologioA('2026-10-29T08:00:00Z');
    cassaDice(false);
    const t = await vetrinaNelBrowser(FORNO);
    expect(t).not.toContain('Consegna oggi');
    expect(t).toContain('Consegna domani');
  });

  it('sabato alle 21, domenica chiuso: né oggi né domani', async () => {
    orologioA('2026-10-31T20:00:00Z');
    cassaDice(true);
    const t = await vetrinaNelBrowser(FORNO);
    expect(t).not.toContain('Consegna oggi');
    expect(t).not.toContain('Consegna domani');
  });

  it('nell’HTML del server il bollino della consegna non c’è: lo decide l’ora del browser', async () => {
    orologioA('2026-10-28T08:00:00Z');
    const { default: HeroSection } = await import('@/components/store-sections/HeroSection');
    const html = renderToStaticMarkup(createElement(HeroSection as never, { config: {}, ctx: ctx(FORNO) }));
    expect(html).not.toContain('Consegna oggi');
    expect(html).not.toContain('Consegna domani');
  });
});

describe('consegnaDellaVetrina: la regola, senza disegno', () => {
  it('stessa risposta della cassa sulle fasce, e la veloce solo col sì', async () => {
    const { consegnaDellaVetrina } = await import('@/lib/promessa-consegna');
    const { romeNow } = await import('@/lib/store-hours');
    const alle = (utc: string) => romeNow(new Date(utc));
    expect(consegnaDellaVetrina({ orari: FORNO, adesso: null, veloce: true })).toBeNull();
    expect(consegnaDellaVetrina({ orari: {}, adesso: alle('2026-10-29T08:00:00Z'), veloce: true })).toBeNull();
    expect(consegnaDellaVetrina({ orari: FORNO, adesso: alle('2026-10-29T19:15:00Z'), veloce: true })).toBe('domani');
    expect(consegnaDellaVetrina({ orari: FORNO, adesso: alle('2026-10-29T08:00:00Z'), veloce: true })).toBe('oggi');
    expect(consegnaDellaVetrina({ orari: FORNO, adesso: alle('2026-10-29T08:00:00Z'), veloce: null })).toBe('domani');
    expect(consegnaDellaVetrina({ orari: FORNO, adesso: alle('2026-10-28T08:00:00Z'), veloce: null })).toBe('oggi');
  });
});
