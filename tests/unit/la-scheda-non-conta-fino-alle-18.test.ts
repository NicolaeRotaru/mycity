import { describe, it, expect } from 'vitest';
import { rigaConsegnaDellaScheda } from '@/lib/promessa-consegna';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';

/**
 * 31/10/2026 (ondata 3) — LA SCHEDA PRODOTTO NON CONTA PIÙ FINO ALLE 18.
 *
 * Il difetto, con la scheda del forno davanti: sabato 31/10 alle 12:30, forno aperto 08-13. La
 * cassa accetta fino alle 12:59, ma la scheda scriveva «Ordina entro 05:30:00 e arriva oggi»: il
 * conto partiva dalle 18 (`DEFAULT_CUTOFF_HOUR`) per ogni negozio. Il sabato alle 21:30 scriveva
 * «Arriva domani» anche se la domenica il forno è chiuso. Il no arrivava dal server, dopo
 * l'indirizzo e il pagamento.
 *
 * La riga ora la decide `rigaConsegnaDellaScheda` con gli orari del negozio. Qui si eseguono le due
 * scene, e si controlla che l'orario limite fisso non sia più esportato da lib/delivery: una
 * funzione che conta fino alle 18 per tutti, lasciata in giro, torna in una scheda.
 */

// Il forno: 08-13 dal lunedì al sabato, domenica chiuso.
const FORNO = {
  sun: [],
  mon: [['08:00', '13:00']],
  tue: [['08:00', '13:00']],
  wed: [['08:00', '13:00']],
  thu: [['08:00', '13:00']],
  fri: [['08:00', '13:00']],
  sat: [['08:00', '13:00']],
};
// Sabato 31 ottobre 2026, ora di Piacenza.
const sabato = (h: number, m = 0) => new Date(2026, 9, 31, h, m);
const CONTO_ALLA_ROVESCIA = /\d{1,2}:\d{2}:\d{2}|ordina entro/i;

describe('la riga della consegna segue gli orari del negozio, non le 18', () => {
  it('sabato 12:30, forno aperto fino alle 13: niente «entro 05:30:00», niente «arriva oggi»', () => {
    const riga = rigaConsegnaDellaScheda({ esaurito: false, orari: FORNO, adesso: sabato(12, 30), veloce: null });
    expect(riga).not.toBeNull();
    expect(riga).not.toMatch(CONTO_ALLA_ROVESCIA);
    expect(riga).not.toMatch(/arriva oggi/i);
  });

  it('sabato 21:30, domenica chiuso: la scheda non promette «domani», dice quando riapre', () => {
    const riga = rigaConsegnaDellaScheda({ esaurito: false, orari: FORNO, adesso: sabato(21, 30), veloce: null });
    expect(riga).not.toMatch(/domani/i);
    expect(riga).toMatch(/chiuso/i);
    expect(riga).toContain('lunedì alle 08:00');
    expect(riga).not.toContain(EXPRESS_ETA_LABEL);
  });

  it('a forno chiuso la veloce non si promette nemmeno se una risposta vecchia diceva sì', () => {
    const riga = rigaConsegnaDellaScheda({ esaurito: false, orari: FORNO, adesso: sabato(13, 30), veloce: true });
    expect(riga).toMatch(/chiuso/i);
    expect(riga).not.toMatch(/veloce/i);
  });
});

describe('lib/delivery non esporta più un orario limite fisso', () => {
  it('niente cutoff delle 18, niente finestra «oggi/domani», niente «2-3 giorni»', async () => {
    const delivery: Record<string, unknown> = await import('@/lib/delivery');
    for (const nome of ['DEFAULT_CUTOFF_HOUR', 'deliveryWindow', 'deliveryEstimate', 'splitDuration', 'STANDARD_ETA_LABEL']) {
      expect(delivery[nome], `${nome} è il conto fino alle 18 uguale per tutti: tolto il 31/10`).toBeUndefined();
    }
    expect(delivery.EXPRESS_ETA_LABEL).toBe('30-60 min');
  });
});
