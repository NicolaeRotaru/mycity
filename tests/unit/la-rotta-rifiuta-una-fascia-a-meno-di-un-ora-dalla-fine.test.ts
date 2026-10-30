/**
 * 30/10/2026 (ondata 21) — LA REGOLA DEI 60 MINUTI, LATO ROTTA DEI CONTANTI.
 *
 * Scelta di Nicola: una fascia si sceglie fino a 60 minuti prima della sua fine. La regola sta in
 * un posto solo (`fasciaFuoriTempo`, lib/quando-arriva.ts): la cassa non propone quello che la
 * rotta rifiuta, e la rotta rifiuta con 409 quello che la cassa non propone più.
 * Le date sono l'orologio di Roma (lunedì 2/11/2026, giovedì 29/10, domenica 1/11).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ETICHETTA_ADESSO,
  consegnaScelta,
  fasceAncoraPossibili,
  fasceDiDomaniPossibili,
  fasciaDiPartenzaOggi,
  fasciaFuoriTempo,
  giornoDiPartenza,
} from '@/lib/quando-arriva';
import { negozioPuoServire } from '@/lib/store-hours';

const GIORNATA: [string, string][] = [['09:00', '13:00'], ['16:30', '19:30']];
const PANE_QUOTIDIANO = { mon: GIORNATA, tue: GIORNATA, wed: GIORNATA, thu: [['09:00', '13:00']], fri: GIORNATA, sat: GIORNATA };
const POMERIGGIO = 'In giornata · 15:00–18:00';

describe('fasciaFuoriTempo: la regola che usa la rotta', () => {
  it('lunedì alle 17:00 la 15:00–18:00 si accetta ancora', () => {
    expect(fasciaFuoriTempo(POMERIGGIO, new Date(2026, 10, 2, 17, 0))).toBeNull();
  });
  it('lunedì alle 17:01 no, e il motivo lo dice', () => {
    expect(fasciaFuoriTempo(POMERIGGIO, new Date(2026, 10, 2, 17, 1))).toMatch(/meno di un’ora/);
  });
  it('a fascia finita dice che è passata', () => {
    expect(fasciaFuoriTempo(POMERIGGIO, new Date(2026, 10, 2, 18, 0))).toMatch(/già passata/);
  });
  it('domani e la veloce non c\'entrano', () => {
    const tardi = new Date(2026, 10, 2, 23, 30);
    expect(fasciaFuoriTempo('Domani · 9:00–12:00', tardi)).toBeNull();
    expect(fasciaFuoriTempo(ETICHETTA_ADESSO, tardi)).toBeNull();
  });
  it('con l\'ora intera resta la regola di prima: alle 19 «Stasera» c\'è, alle 20 no', () => {
    expect(fasceAncoraPossibili(19)).toEqual(['Stasera · 18:00–20:00']);
    expect(fasceAncoraPossibili(20)).toEqual([]);
  });
});

describe('i casi di Pane Quotidiano', () => {
  it('giovedì alle 14:00 oggi niente, si parte da domani 9:00–12:00', () => {
    const d = new Date(2026, 9, 29, 14, 0);
    expect(fasciaDiPartenzaOggi(d, [PANE_QUOTIDIANO])).toBeNull();
    expect(giornoDiPartenza(d, [PANE_QUOTIDIANO])).toBe('tomorrow');
    expect(fasceDiDomaniPossibili(d, [PANE_QUOTIDIANO])[0]).toBe('Domani · 9:00–12:00');
  });
  it('domenica alle 10:00 niente oggi', () => {
    expect(fasceAncoraPossibili(new Date(2026, 10, 1, 10, 0), [PANE_QUOTIDIANO])).toEqual([]);
  });
  it('sabato per la domenica chiusa niente domani, e la cassa lo frena', () => {
    const d = new Date(2026, 10, 7, 20, 30);
    expect(fasceDiDomaniPossibili(d, [PANE_QUOTIDIANO])).toEqual([]);
    const c = consegnaScelta({
      giorno: 'tomorrow', ora: 20, fasciaOggi: '', fasciaDomani: 'Domani · 9:00–12:00',
      ritiroInNegozio: false, adesso: d, orari: [PANE_QUOTIDIANO],
    });
    expect(c.tipo).toBe('non-valida');
  });
});

describe('una settimana intera, minuto per minuto: ogni fascia proposta la rotta la accetta', () => {
  it('lunedì 2/11 - domenica 8/11', () => {
    const rifiutate: string[] = [];
    let proposte = 0;
    for (let m = 0; m < 7 * 24 * 60; m++) {
      const d = new Date(2026, 10, 2, 0, m);
      const cassa = [...fasceAncoraPossibili(d, [PANE_QUOTIDIANO]), ...fasceDiDomaniPossibili(d, [PANE_QUOTIDIANO])];
      for (const f of cassa) {
        proposte++;
        // È quello che fa la rotta dei contanti: prima i 60 minuti, poi gli orari di ogni negozio.
        if (fasciaFuoriTempo(f, d) !== null || !negozioPuoServire(PANE_QUOTIDIANO, f, d)) {
          rifiutate.push(`${d.toString()} · ${f}`);
        }
      }
    }
    expect(proposte).toBeGreaterThan(10_000);
    expect(rifiutate.slice(0, 5)).toEqual([]);
  });
});

describe('la rotta dei contanti usa la stessa regola', () => {
  it('controlla i 60 minuti prima degli orari dei negozi, e risponde con un 409', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/orders/cod/route.ts'), 'utf8');
    const regola = src.indexOf('fasciaFuoriTempo(body.deliverySlot');
    const orari = src.indexOf('negozioPuoServire(s.store_hours, body.deliverySlot)');
    expect(regola).toBeGreaterThan(-1);
    expect(regola).toBeLessThan(orari);
    expect(src.slice(regola, orari)).toContain('ApiErrors.conflict(fuoriTempo)');
  });
});
