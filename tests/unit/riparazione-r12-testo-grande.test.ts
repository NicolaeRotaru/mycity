/**
 * R12 — IL TELEFONO STRETTO COL TESTO AL 200%.
 *
 * Col testo al 200% le misure in rem raddoppiano: un elemento in una riga flessibile che non può
 * stringersi (min-width automatico = la sua parola più lunga) e non può andare a capo allarga la
 * pagina, e la pagina scorre di lato. Misurato in Chromium con la radice del testo a 32px.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const classi = (s: string) => s.split(/\s+/).filter(Boolean);

describe('R12-007 — i tre passi della home non fanno scorrere la pagina di lato', () => {
  // Misurato: a 320 px col testo al 200% i titoli accanto al cerchio portavano la pagina a 367 px.
  const src = readFileSync('components/home/HowItWorks.tsx', 'utf8');
  const m = src.match(/<div className="([^"]*)">\s*<span className=\{`relative shrink-0[\s\S]*?<\/span>\s*<h3 className="([^"]*)">\{s\.title\}<\/h3>/);

  it('il titolo del passo si trova accanto al suo cerchio', () => {
    expect(m, 'la riga cerchio + titolo dei tre passi non si trova più: la prova va rifatta').toBeTruthy();
  });

  it('se accanto al cerchio non c\'è posto il titolo va sotto, e le parole vanno a capo', () => {
    const riga = classi(m![1]);
    const titolo = classi(m![2]);
    expect(riga, 'controprova: è una riga flessibile').toContain('flex');
    expect(riga, 'la riga non va a capo: col testo al 200% il titolo resta accanto al cerchio e allarga la pagina').toContain('flex-wrap');
    expect(titolo, 'il titolo non si può stringere sotto la sua parola più lunga: la pagina scorre di lato').toContain('min-w-0');
    expect(titolo, 'una parola più lunga della riga non va a capo').toContain('break-words');
    // Con flex-wrap e la base automatica il titolo andrebbe sotto anche col testo normale (la sua base
    // sarebbe la riga intera): una base piccola lo tiene accanto al cerchio finché ci sta.
    expect(titolo.some((c) => /^basis-/.test(c)), 'il titolo senza base va sotto il cerchio anche col testo normale').toBe(true);
  });
});
