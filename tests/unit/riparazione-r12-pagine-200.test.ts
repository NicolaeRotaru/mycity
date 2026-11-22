import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R12 — pagine pubbliche col testo al 200% a 280 px (lo schermo esterno dei pieghevoli).
 * Prove leggere sul sorgente: ogni voce guarda le classi che chiudono il difetto misurato in Chrome.
 */

const leggi = (p: string) => readFileSync(p, 'utf8');

/** Dall'ultima apertura di <nome> che precede un testo, fino al testo. */
const tagPrima = (src: string, testo: string, nome: string) => {
  const i = src.search(new RegExp('\\n\\s*' + testo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  expect(i, `«${testo}» non c'è`).toBeGreaterThan(-1);
  const da = src.slice(0, i).lastIndexOf(`<${nome}`);
  // Dall'apertura del tag fino al testo (le funzioni `=>` negli attributi non interrompono la lettura).
  return da < 0 ? '' : src.slice(da, i);
};

describe('R12-001 · /about, «Come siamo arrivati qui» a 280 px col testo al 200%', () => {
  const src = leggi('app/about/page.tsx');
  it('il titolo va a capo dentro una parola lunga', () => {
    const h2 = tagPrima(src, 'Come siamo arrivati qui', 'h2');
    expect(h2).toContain('break-words');
    expect(h2).toContain('hyphens-auto');
  });
  it('la colonna del titolo può stringersi sotto la parola più larga (min-w-0)', () => {
    const div = tagPrima(src, 'Come siamo arrivati qui', 'div');
    expect(div).toContain('order-1');
    expect(div).toContain('min-w-0');
  });
});

describe('R12-002 · /stores, i filtri a 280 px col testo al 200%', () => {
  const src = leggi('app/stores/page.tsx');
  it('«Aperti ora» può andare a capo e non supera la riga', () => {
    const bottone = tagPrima(src, 'Aperti ora', 'button');
    expect(bottone).toContain('max-w-full');
    expect(bottone).not.toContain('whitespace-nowrap');
  });
  it('il menu «Ordina i negozi» non supera mai la riga', () => {
    const sel = tagPrima(src, '<option value="rating">', 'select');
    expect(sel).toContain('max-w-full');
  });
});

describe('R12-004 · /lavora-con-noi, le righe delle posizioni a 280 px col testo al 200% (correzione continua)', () => {
  const src = leggi('app/lavora-con-noi/page.tsx');
  it('nessun gradino fisso: niente max-[300px] nelle righe delle posizioni', () => {
    const da = src.indexOf('{/* Posizioni aperte */}');
    const a = src.indexOf('{/* CTA finale */}');
    expect(src.slice(da, a)).not.toContain('max-[');
    expect(src.slice(da - 900, da)).not.toContain('max-[');
  });
  it('i margini della pagina e della riga si stringono con lo schermo (min(rem, vw))', () => {
    expect(tagPrima(src, '{/* Posizioni aperte */}', 'div')).toContain('px-[min(1.5rem,7.5vw)]');
    expect(tagPrima(src, '<div className="flex-1 min-w-[min(200px,100%)]">', 'li')).toContain('px-[min(1.25rem,6.25vw)]');
  });
  it('«Candidati» ha il margine che si stringe e la freccia può andare sotto invece di spezzare la parola', () => {
    const link = tagPrima(src, 'Candidati', 'a');
    expect(link).toContain('px-[min(1rem,5vw)]');
    expect(link).toContain('flex-wrap');
  });
  it('la pillola del tipo di posizione può andare a capo e non esce dalla riga', () => {
    const pillola = tagPrima(src, '{job.tag}', 'span');
    expect(pillola).toContain('max-w-full');
    expect(pillola).not.toContain('whitespace-nowrap');
  });
});

describe('R12-002 (giro 2) · i testi restano nel loro riquadro a 280 px col testo al 200%', () => {
  it('/faq: il riquadro «Non hai trovato la risposta?» manda a capo le parole lunghe', () => {
    const div = tagPrima(leggi('app/faq/page.tsx'), '<h3 className="text-xl font-bold mb-2">', 'div');
    expect(div).toContain('break-words');
    expect(div).toContain('hyphens-auto');
  });
  it('/returns: il riquadro del recesso e i riquadri sotto vanno a capo (break-words si eredita)', () => {
    const src = leggi('app/returns/page.tsx');
    expect(tagPrima(src, '<div className="flex flex-wrap items-start gap-4">', 'div')).toContain('break-words');
    expect(tagPrima(src, '<section className="rounded-2xl border border-cream-300 bg-white p-6">', 'div')).toContain('break-words');
  });
  it('/lavora-con-noi: i tre riquadri vanno a capo dentro il riquadro', () => {
    const riquadro = tagPrima(leggi('app/lavora-con-noi/page.tsx'), '<span className="w-[50px]', 'div');
    expect(riquadro).toContain('break-words');
    expect(riquadro).toContain('hyphens-auto');
  });
});
