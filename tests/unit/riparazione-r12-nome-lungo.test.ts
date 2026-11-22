/**
 * R12 — UN NOME DI NEGOZIO LUNGO NON ALLARGA LA PAGINA SUL TELEFONO.
 *
 * Il titolo della scheda (home, elenco negozi) e della riga («Vicino a te») era un `inline-flex`
 * senza tetto di larghezza: una scatola così è larga quanto il suo contenuto, e un nome lungo senza
 * spazi la portava oltre la scheda. Misurato in Chromium a 320 px con un nome di 70 lettere: la
 * pagina larga 590 px (home ed elenco) e 690 px («Vicino a te») invece di 320. Con `max-w-full` il
 * titolo resta nella scheda e il nome, che ha già `truncate`, si taglia coi puntini.
 *
 * Il tetto dei caratteri del nome c'è già nella rotta della domanda (80, con la sua prova): qui si
 * guarda il disegno, che deve reggere anche ottanta lettere attaccate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const titoloDelNome = (file: string) => {
  const src = readFileSync(file, 'utf8');
  const m = src.match(/<h3 className="([^"]*)"[^>]*>\s*<span className="([^"]*)">\{store\.store_name\}<\/span>/);
  expect(m, `${file}: il titolo col nome del negozio non si trova`).toBeTruthy();
  return { titolo: m![1].split(/\s+/), nome: m![2].split(/\s+/) };
};

describe('R12-009 — il titolo col nome del negozio resta dentro la scheda', () => {
  for (const file of ['components/StorePreviewCard.tsx', 'components/StoreListRow.tsx']) {
    it(file, () => {
      const { titolo, nome } = titoloDelNome(file);
      expect(nome, 'controprova: il nome si taglia coi puntini').toContain('truncate');
      // Una scatola in linea (inline-flex) è larga quanto il suo contenuto: senza un tetto il nome lungo la allarga.
      const inLinea = titolo.includes('inline-flex') || titolo.includes('inline-block');
      const conTetto = titolo.includes('max-w-full') || titolo.includes('w-full');
      expect(!inLinea || conTetto, `${file}: il titolo è in linea senza max-w-full, un nome lungo allarga la pagina`).toBe(true);
    });
  }
});
