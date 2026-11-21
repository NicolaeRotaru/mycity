import { describe, it, expect } from 'vitest';
import {
  testoSenzaIndirizzi,
  testoSenzaRecapiti,
  strutturaSenzaIndirizzi,
} from '@/lib/analytics/filmato-senza-dati-personali';

function quantoCi(fai: () => unknown): number {
  const inizio = performance.now();
  fai();
  return performance.now() - inizio;
}

describe('S01 · il filtro regge testi lunghi', () => {
  it('tempo lineare su testi lunghi', () => {
    const lungo = 'a'.repeat(100_000 - 1) + '@';
    const ms = quantoCi(() => testoSenzaRecapiti(lungo));
    expect(ms, `ci ha messo ${Math.round(ms)} ms`).toBeLessThan(200);
  }, 60_000);

  it('tempo lineare su una struttura con testi lunghi', () => {
    const lungo = 'a.'.repeat(25_000 - 1) + 'a@';
    const ms = quantoCi(() => strutturaSenzaIndirizzi({ uno: lungo, due: [lungo] }));
    expect(ms, `ci ha messo ${Math.round(ms)} ms`).toBeLessThan(200);
  }, 60_000);

  for (const [nome, testo, atteso] of [
    ['a inizio testo', 'mario.rossi@gmail.com scrive', '*** scrive'],
    ['dopo uno spazio', 'scrivi a mario.rossi@gmail.com', 'scrivi a ***'],
    ['dopo la punteggiatura', 'contatti:mario@x.it,anna@y.it', 'contatti:***,***'],
    ['fra parentesi', '(mario@x.it)', '(***)'],
    ['fra virgolette', '"mario@x.it" e \'anna@y.it\'', '"***" e \'***\''],
    ['a fine frase', 'scrivimi a mario.rossi@gmail.com.', 'scrivimi a ***.'],
    ['due attaccate', 'a@b.it+c@d.it', '******'],
  ] as const) {
    it(`oscura le email ${nome}`, () => {
      expect(testoSenzaRecapiti(testo)).toBe(atteso);
      expect(testoSenzaIndirizzi(testo)).toBe(atteso);
    });
  }

  it('un testo senza email non cambia', () => {
    for (const testo of ['ordine pronto alle 18:30', 'react@18.3.1', 'nessun dato, solo parole.', 'a'.repeat(5_000)]) {
      expect(testoSenzaRecapiti(testo)).toBe(testo);
    }
  });
});
