import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R28-004 — la fascia scura finale di «Chi siamo» a 280 px col testo al 200%.
 * Misurato in Chromium (html{font-size:200%}): con p-8 la colonna interna restava di 56 px e i pulsanti
 * uscivano dalla fascia. Prova leggera sulle classi: pulsanti a tutta larghezza sotto sm, icona che può
 * andare sopra il testo, parole che vanno a capo intere (mai [overflow-wrap:anywhere]: a 30 px per il
 * testo «Lavora» si spezzava lettera per lettera), margine normale (p-8, px-5) sopra le soglie.
 */
const src = readFileSync('app/about/page.tsx', 'utf8');
const dopo = src.slice(src.indexOf('{/* CTA band scura */}'));
const classiDel = (re: RegExp) => (dopo.match(re)?.[1] ?? '').split(/\s+/);
const banda = classiDel(/<div className="(bg-ink-900[^"]*)"/);
const riga = classiDel(/<div className="(flex flex-wrap[^"]*)"/);
const bottoni = Array.from(dopo.matchAll(/<Link\s+href="([^"]+)"\s+className="([^"]*)"/g)).map((m) => ({ href: m[1], c: m[2].split(/\s+/) }));

describe('R28-004 · fascia finale di «Chi siamo»', () => {
  it('sotto sm il margine della fascia si stringe solo sugli schermi stretti; p-8 e md:p-11 restano', () => {
    expect(banda).toContain('p-8');
    expect(banda).toContain('md:p-11');
    expect(banda).toContain('max-sm:p-[min(2rem,10vw)]');
  });
  it('sotto sm i pulsanti stanno in colonna, a tutta larghezza', () => {
    expect(riga).toContain('max-sm:flex-col');
    expect(riga).toContain('min-w-0');
  });
  it('i due pulsanti vanno a capo per parole, con l icona che può andare sopra, e non spezzano le lettere', () => {
    expect(bottoni.map((b) => b.href)).toEqual(['/lavora-con-noi', '/sell']);
    for (const { href, c } of bottoni) {
      expect(c, href).toContain('flex-wrap');
      expect(c, href).toContain('justify-center');
      expect(c, href).toContain('max-w-full');
      expect(c, href).toContain('max-sm:px-3');
      expect(c, href).toContain('px-5');
      expect(c.join(' '), href).not.toContain('overflow-wrap:anywhere');
    }
  });
});
