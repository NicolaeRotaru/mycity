import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FINO_AL_CONFINE, FRASE_DELLA_ZONA, motivoFuoriZona } from '@/lib/ordini/zona-di-consegna';

const FONTE = readFileSync('lib/ordini/zona-di-consegna.ts', 'utf8');
const PROVA_FONTE = readFileSync('tests/unit/riparazione-r09-la-frase-della-zona-ha-una-fonte-sola.test.ts', 'utf8');
const NUMERI: Record<string, number> = { due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7 };

describe('la frase della zona: il rifiuto la usa, e i commenti e i titoli dicono il vero', () => {
  it('il rifiuto e la frase della cassa nascono dalla stessa fonte', () => {
    expect(motivoFuoriZona('Pane')).toContain(FINO_AL_CONFINE);
    expect(FRASE_DELLA_ZONA).toContain(FINO_AL_CONFINE);
  });
  it('il commento in testa alla fonte non dice «una volta sola» mentre due layout la riscrivono', () => {
    const testa = FONTE.slice(0, FONTE.indexOf('export const CONFINE_DELLA_ZONA'));
    const ancoraACopie = ['app/near/layout.tsx', 'app/category/[slug]/layout.tsx']
      // 28/11/2026 (R09-004) — Contano le righe di codice, non i commenti che raccontano la storia.
      .filter((f) => readFileSync(f, 'utf8').split('\n').some((r) => !/^\s*(\/\/|\/\*|\*)/.test(r) && /km dal negozio/.test(r)));
    if (ancoraACopie.length > 0) {
      for (const f of ancoraACopie) expect(testa, `il commento tace la copia in ${f}`).toContain(f);
      expect(testa).not.toMatch(/SI SCRIVE QUI, UNA VOLTA SOLA/);
    }
  });
  it('il titolo della prova sulla fonte conta i posti dell\'elenco', () => {
    const elenco = PROVA_FONTE.match(/const ALTRI = \[([\s\S]*?)\];/)![1];
    const quanti = (elenco.match(/'[^']+'/g) ?? []).length;
    const detto = PROVA_FONTE.match(/altri (\w+) posti/)![1];
    expect(NUMERI[detto]).toBe(quanti);
  });
});
