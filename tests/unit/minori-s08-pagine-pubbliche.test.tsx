/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * S08 (5/11/2026) — Pagine pubbliche: Chi siamo, Dichiarazione di
 * accessibilità e l'anteprima dei link condivisi.
 */

const RADICE = path.resolve(__dirname, '../..');
const leggi = (f: string) => readFileSync(path.join(RADICE, f), 'utf8');

describe('i link condivisi in chat hanno la copertina (scheda 373)', () => {
  const PAGINE = [
    'about', 'come-funziona', 'lavora-con-noi', 'help', 'shipping',
    'returns', 'terms', 'privacy', 'status', 'accessibility',
  ];
  for (const p of PAGINE) {
    it(`/${p} dichiara l immagine di anteprima nel suo openGraph`, () => {
      // Letto dal sorgente: alcune di queste pagine importano moduli solo-server.
      const src = leggi(`app/${p}/page.tsx`);
      const og = /openGraph:\s*\{([\s\S]*?)\n  \},/.exec(src)?.[1];
      expect(og, `/${p} non ha più un openGraph suo: rivedere la prova`).toBeTruthy();
      expect(
        og,
        `/${p}: un openGraph senza images sostituisce quello del sito e il link esce senza copertina`,
      ).toMatch(/images:\s*\['\/opengraph-image'\]/);
    });
  }
});

describe('Chi siamo dice la verità e in italiano (schede 365, 510)', () => {
  const sorgente = leggi('app/about/page.tsx');
  it('non scrive «Pay-on-delivery» in grande', () => {
    expect(sorgente).not.toMatch(/value: 'Pay-on-delivery'/i);
    expect(sorgente).toContain("value: 'Alla consegna'");
  });
  it('non racconta una flotta di rider né una crescita quartiere dopo quartiere', () => {
    expect(sorgente).not.toMatch(/flotta di rider/i);
    expect(sorgente).not.toMatch(/cresce quartiere dopo/i);
  });
});

describe('la Dichiarazione di accessibilità (schede 416, 1579)', () => {
  async function pagina() {
    const mod = await monta('app/accessibility/page.tsx');
    return accendi(mod.default, {});
  }

  it('i link per segnalare un problema sono sottolineati sempre, non solo col mouse', async () => {
    const s = await pagina();
    const link = Array.from(s.radice.querySelectorAll('a')).filter((a) =>
      /contact|agid|mailto:/i.test(a.getAttribute('href') ?? ''),
    );
    expect(link.length).toBeGreaterThanOrEqual(3);
    for (const a of link) {
      const classi = (a.getAttribute('class') ?? '').split(/\s+/);
      expect(classi, `il link ${a.getAttribute('href')} si riconosce solo dal colore`).toContain('underline');
    }
    s.smonta();
  }, 60000);

  it('le tre date dicono la stessa revisione, e non il 20 agosto', async () => {
    const s = await pagina();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/20 agosto 2026|2026-08-20/);
    expect(testo).toContain('Ultimo aggiornamento: 2026-09-08');
    expect(testo).toContain('8 settembre 2026');
    expect(testo).toContain('redatta il 2026-09-08');
    s.smonta();
  }, 60000);
});

describe('la pagina che chiede di riaccettare dice cosa è cambiato (scheda 2590)', () => {
  it('nomina la versione, la data e le voci che cambiano', async () => {
    const { VERSIONE_TESTI_LEGALI, TERMINI_IN_VIGORE_DAL, COSA_CAMBIA_NEI_TERMINI } = await import('@/lib/legal/versione');
    const mod = await monta('app/accetta-condizioni/page.tsx');
    const s = accendi(mod.default, {});
    const testo = testoVisibile(s.radice);
    const versione = /terms-([\d.]+)/.exec(VERSIONE_TESTI_LEGALI)![1];
    expect(testo).toContain(`versione ${versione}`);
    expect(testo).toContain(TERMINI_IN_VIGORE_DAL);
    expect(COSA_CAMBIA_NEI_TERMINI.length).toBeGreaterThan(0);
    for (const voce of COSA_CAMBIA_NEI_TERMINI) expect(testo).toContain(voce);
    expect(testo).toMatch(/recesso/);
    s.smonta();
  }, 60000);
});
