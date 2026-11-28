import { describe, it, expect, vi, afterEach } from 'vitest';
import { avvisoDelBonificoDaFare } from '@/lib/rimborsi/bonifici-da-fare';

/**
 * R05 (27/11/2026) — L'AVVISO DEL BONIFICO DI RIMBORSO DICE SE IL TERMINE DEI 14 GIORNI È GIÀ PASSATO O VICINO.
 *
 * Il reso si rimborsa quando il pacco torna al negozio: spesso a ridosso dei 14 giorni dalla richiesta
 * (Codice del Consumo, art. 56), o dopo. L'avviso diceva solo «il termine è il 16 novembre», anche se il
 * 16 novembre era già passato, e nessun altro lo segnava. Adesso, con il termine passato o a 3 giorni o
 * meno (a calendario di Piacenza), l'avviso lo dice. L'orologio è finto.
 */

const ORDINE = 'a1b2c3d4-0000-0000-0000-000000000001';

function avvisoDelReso(chiave = 'return_f00dcafe-1', resoChiestoIl: string | null = '2026-11-02T10:00:00Z') {
  return avvisoDelBonificoDaFare({
    ordineId: ORDINE,
    bonificoCents: 3000,
    creditoCents: 0,
    emailCliente: 'giulia@esempio.it',
    chiave,
    resoChiestoIl,
    casella: 'info@esempio.it',
  }).testo;
}

function alle(istante: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(istante));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('R05 — il termine dei 14 giorni nell avviso del bonifico di rimborso', () => {
  it('reso chiesto il 2/11, rimborsato il 20/11: dice che il termine è passato da 4 giorni', () => {
    alle('2026-11-20T09:00:00Z');
    const testo = avvisoDelReso();
    expect(testo).toContain('quindi il termine è il 16 novembre 2026. Termine passato da 4 giorni (16 novembre 2026).');
  });

  it('a mezzanotte di Piacenza cambia il giorno: alle 23:30 del 16/11 scade oggi, alle 00:30 del 17/11 è passato', () => {
    alle('2026-11-16T22:30:00Z');
    expect(avvisoDelReso()).toContain('Scade oggi (16 novembre 2026).');
    alle('2026-11-16T23:30:00Z');
    expect(avvisoDelReso()).toContain('Termine passato da 1 giorno (16 novembre 2026).');
  });

  it('a 1 e a 3 giorni dal termine lo dice; a 4 giorni no', () => {
    alle('2026-11-15T08:00:00Z');
    expect(avvisoDelReso()).toContain('Scade domani (16 novembre 2026).');
    alle('2026-11-13T08:00:00Z');
    expect(avvisoDelReso()).toContain('Mancano 3 giorni al termine (16 novembre 2026).');
    alle('2026-11-12T08:00:00Z');
    const conTempo = avvisoDelReso();
    expect(conTempo).toContain('il termine è il 16 novembre 2026.');
    expect(conTempo).not.toMatch(/Termine passato|Scade oggi|Scade domani|Mancano \d+ giorni/u);
  });

  it('un reclamo col giorno di apertura passato da più di 14 giorni lo dice; senza giorno il termine resta sconosciuto', () => {
    alle('2026-11-20T09:00:00Z');
    expect(avvisoDelReso('dispute_d1', '2026-11-01T09:00:00Z')).toContain('Termine passato da 5 giorni (15 novembre 2026).');
    const senzaGiorno = avvisoDelReso('dispute_d1', null);
    expect(senzaGiorno).toContain('Il termine non lo sappiamo');
    expect(senzaGiorno).not.toMatch(/Termine passato|Scade oggi|Scade domani|Mancano \d+ giorni/u);
  });
});
