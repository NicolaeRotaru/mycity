import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENITORE_PAGINA_NEGOZIO } from '@/components/store-sections/misure-vetrina';

/**
 * R09-013 — La larghezza del percorso d'acquisto è una sola (max-w-7xl, 1280 px, margine
 * px-4 sm:px-6) anche nella vetrina del negozio, nello scheletro e nelle pagine d'errore.
 *
 * Dopo il primo giro categorie, negozi, scheda, carrello e cassa erano a 7xl, ma la vetrina del
 * negozio restava a max-w-5xl (la costante condivisa con lo scheletro), e lo scheletro e le pagine
 * d'errore di prodotto e negozio non avevano tetto: da 2xl in su larghi 1536 px contro i 1280 della
 * pagina, quindi la larghezza saltava proprio mentre la pagina arrivava.
 */

const radice = join(__dirname, '..', '..');
const leggi = (p: string) => readFileSync(join(radice, p), 'utf8');

const LARGHEZZA = 'max-w-7xl';
const MARGINE = ['px-4', 'sm:px-6'];

function controlla(classi: string) {
  const parole = classi.split(/\s+/);
  expect(parole.filter((p) => /^max-w-/.test(p)), classi).toEqual([LARGHEZZA]);
  for (const m of MARGINE) expect(parole, classi).toContain(m);
}

describe('R09-013 — una larghezza sola anche in vetrina, nell’attesa e negli errori', () => {
  it('la vetrina del negozio (pagina, sottopagina e scheletro) usa max-w-7xl', () => {
    controlla(CONTENITORE_PAGINA_NEGOZIO);
    for (const f of ['app/store/[id]/page.tsx', 'app/store/[id]/[slug]/page.tsx', 'components/store-sections/ScheletroNegozio.tsx']) {
      expect(leggi(f), f).toMatch(/className=\{CONTENITORE_PAGINA_NEGOZIO\}/);
    }
  });

  it.each([
    'app/product/[id]/loading.tsx',
    'app/product/[id]/error.tsx',
    'app/store/[id]/error.tsx',
  ])('%s: il contenitore principale ha la larghezza del percorso', (f) => {
    const contenitori = [...leggi(f).matchAll(/className="(container mx-auto [^"]*)"/g)].map((m) => m[1]!);
    expect(contenitori.length, 'nessun contenitore trovato').toBeGreaterThan(0);
    contenitori.forEach(controlla);
  });

  it('il banner della vetrina, ora più largo, chiede la foto «hero» intera (1200 px), non quella da 1024', () => {
    // Il contenitore a 7xl è largo 1232 px dentro i margini: 1200 è la misura «hero» di lib/image-url.ts,
    // e la prova la-foto-chiesta-piu-piccola-del-riquadro vieta di dichiarare un riquadro più largo della foto.
    expect(leggi('components/store-sections/BannerSection.tsx')).toMatch(/sizes="\(max-width: 768px\) 100vw, 1200px"/);
  });
});
