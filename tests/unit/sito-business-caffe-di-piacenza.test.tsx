/**
 * @vitest-environment jsdom
 */
/**
 * 27/11/2026 — IL SITO BUSINESS DEL CAFFÈ DI PIACENZA, nella voce «Sito web» del suo pannello.
 * Nicola: «siccome l'ho già iscritto Caffè di Piacenza… dentro la voce del menu sito web ci deve essere già il
 * suo sito web versione business». Il lavoro consegnato vale negozio per negozio, non solo per SDG.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { SitoSchema, type Sito } from '@/lib/agenzia/lavoro-consegnato/tipi';
import { lavoroConsegnatoDi } from '@/lib/agenzia/lavoro-consegnato/registro';
import { CAFFE_DI_PIACENZA_ID, originiDeiSitiOnline } from '@/lib/agenzia/lavoro-consegnato/siti';
import { parteDaMostrare } from '@/lib/agenzia/lavoro-consegnato/quale-parte';
import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';
import SitoConsegnato from '@/components/seller/lavoro-consegnato/SitoConsegnato';

const FILE = path.resolve(__dirname, '../../lib/agenzia/lavoro-consegnato/caffe-di-piacenza/sito.json');
const grezzo = () => JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>;

describe('il Caffè di Piacenza ha il suo sito nel lavoro consegnato', () => {
  it('il suo sito.json è nella forma del contratto, con la lista «cosa ha di Business»', () => {
    const r = SitoSchema.safeParse(grezzo());
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 5))).toBe(true);
    if (r.success) {
      expect(r.data.titolo).toContain('Caffè di Piacenza');
      expect(r.data.cosa_ha_di_business.length).toBeGreaterThan(0);
      expect(r.data.pagine.map((p) => p.percorso)).toEqual(['/', '/il-bar/', '/menu/', '/dicembre/', '/contatti/']);
    }
  });

  it('entra il Caffè: fascia Business e solo il sito (niente social, niente analisi)', () => {
    const l = lavoroConsegnatoDi(CAFFE_DI_PIACENZA_ID);
    expect(l?.fascia).toBe('business');
    expect(l?.sito?.titolo).toContain('Caffè di Piacenza');
    expect(l?.social).toBeUndefined();
    expect(l?.analisi).toBeUndefined();
    expect(parteDaMostrare('sito_web', l)).toBe('sito');
    expect(parteDaMostrare('social', l)).toBeNull();
    expect(parteDaMostrare('analisi', l)).toBeNull();
  });

  it("l'id si legge anche in maiuscolo o con spazi; un negozio fuori registro resta col preventivo", () => {
    expect(lavoroConsegnatoDi(` ${CAFFE_DI_PIACENZA_ID.toUpperCase()} `)?.fascia).toBe('business');
    expect(lavoroConsegnatoDi('8bbc42b0-f56d-4da4-a567-9ceb0261b7f1')).toBeNull();
    expect(lavoroConsegnatoDi('__proto__')).toBeNull();
    expect(lavoroConsegnatoDi('constructor')).toBeNull();
  });

  it('SDG resta Premium coi suoi lavori', () => {
    const l = lavoroConsegnatoDi(SDG_SELLER_ID);
    expect(l?.fascia).toBe('premium');
    expect(l?.sito).toBeDefined();
  });
});

describe('quali siti possono entrare nella pagina (frame-src)', () => {
  it('solo i siti online con indirizzo https, una volta sola, e mai un dominio intero', () => {
    const origini = originiDeiSitiOnline([
      { stato: 'online', indirizzo: 'https://caffe-di-piacenza.vercel.app/' },
      { stato: 'online', indirizzo: 'https://caffe-di-piacenza.vercel.app/menu/' },
      { stato: 'da_pubblicare', indirizzo: 'https://non-ancora.vercel.app' },
      { stato: 'online', indirizzo: 'http://senza-lucchetto.it' },
      { stato: 'online', indirizzo: 'non è un indirizzo' },
      { stato: 'online', indirizzo: null },
      null,
      'testo',
    ]);
    expect(origini).toEqual(['https://caffe-di-piacenza.vercel.app']);
  });

  it('coi file veri non entra niente che non sia online', () => {
    for (const o of originiDeiSitiOnline()) {
      expect(o.startsWith('https://')).toBe(true);
      expect(o).not.toContain('*');
    }
  });
});

describe('la voce «Sito web» mostra il sito dal vivo quando è online', () => {
  let root: Root | null = null;
  let box: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; });
  const monta = (sito: Sito, fascia: 'business' | 'premium') => {
    box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
    act(() => root!.render(createElement(SitoConsegnato, { sito, fascia })));
    return box;
  };
  const base = SitoSchema.parse(grezzo());

  it('online: il sito sta dentro la pagina, navigabile, e la lista dice «Business»', () => {
    const el = monta({ ...base, stato: 'online', indirizzo: 'https://caffe-di-piacenza.vercel.app' }, 'business');
    const frame = el.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('https://caffe-di-piacenza.vercel.app');
    expect(frame?.getAttribute('sandbox')).toContain('allow-scripts');
    expect(el.textContent).toContain('Il tuo sito, dal vivo');
    expect(el.textContent).toContain('Cosa ha di Business');
    expect(el.textContent).not.toContain('Cosa ha di Premium');
    expect(el.querySelector('a[href="https://caffe-di-piacenza.vercel.app"]')?.textContent).toContain('Apri il sito');
  });

  it('non ancora pubblicato: niente riquadro vuoto, la frase dice che arriva', () => {
    const el = monta({ ...base, stato: 'da_pubblicare', indirizzo: null }, 'business');
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.textContent).toContain('Da pubblicare');
    expect(el.textContent).toContain('appena è pubblicato lo vedi qui');
  });

  it('un indirizzo «online» ma vuoto non apre un riquadro', () => {
    const el = monta({ ...base, stato: 'online', indirizzo: null }, 'business');
    expect(el.querySelector('iframe')).toBeNull();
  });
});
