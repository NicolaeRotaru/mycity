import { describe, it, expect } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';
import { entroQuandoAccettare, rigaScadenzaPerIlNegozio } from '@/lib/ordini/scadenza-accettazione';

/**
 * Sessione S02 (5/11/2026) — la scadenza dell'accettazione detta al negozio.
 *  · 2511: con le ferie (settimana scritta tutta chiusa) la regola degli orari è quella di
 *          lib/store-hours: il ritiro è impossibile, l'ordine scade subito, non a fine fascia;
 *  · 2363: prima dei 10 minuti la riga non dice «la veloce cade» come cosa certa;
 *  · 2377: dopo i 10 minuti, prima del freno, dice che accettando resta veloce (30-60 min);
 *  · 2359: senza orari, nell'ultima ora della fascia avvisa che la consegna deve arrivare in tempo.
 */
const FERIE = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

describe('la scadenza dell accettazione', () => {
  it('2511 · in ferie un ordine per domani non resta vivo fino a fine fascia', () => {
    const creato = '2026-11-02T20:00:00.000Z';
    const entro = entroQuandoAccettare({ created_at: creato, delivery_slot: 'Domani · 9:00–12:00' }, FERIE);
    expect(entro?.toISOString()).toBe(creato);
  });

  it('2363 · prima dei 10 minuti: niente «la veloce cade» detto come certo', () => {
    const riga = rigaScadenzaPerIlNegozio(
      { created_at: '2026-10-31T19:20:00.000Z', delivery_slot: ETICHETTA_ADESSO },
      new Date('2026-10-31T19:22:00.000Z'),
    );
    expect(riga).not.toContain('la veloce cade');
    expect(riga).toContain('resta una consegna veloce');
  });

  it('2377 · fra il decimo minuto e il freno: accettando resta veloce, da consegnare in 30-60 minuti', () => {
    const riga = rigaScadenzaPerIlNegozio(
      { created_at: '2026-10-30T17:05:20.000Z', delivery_slot: ETICHETTA_ADESSO },
      new Date('2026-10-30T17:16:00.000Z'),
    );
    expect(riga).toContain('Se lo accetti adesso resta una consegna veloce');
    expect(riga).toContain('30-60 min');
  });

  it('2359 · senza orari, alle 11:50 per la 9:00–12:00: avvisa che la fascia sta per finire', () => {
    // Sabato 31/10, 11:50 a Piacenza = 10:50 UTC; ordine di venerdì sera per «Domani».
    const riga = rigaScadenzaPerIlNegozio(
      { created_at: '2026-10-30T20:15:00.000Z', delivery_slot: 'Domani · 9:00–12:00' },
      new Date('2026-10-31T10:50:00.000Z'),
    );
    expect(riga).toContain('la fascia sta per finire');
    const prima = rigaScadenzaPerIlNegozio(
      { created_at: '2026-10-30T20:15:00.000Z', delivery_slot: 'Domani · 9:00–12:00' },
      new Date('2026-10-31T08:00:00.000Z'),
    );
    expect(prima).not.toContain('la fascia sta per finire');
  });
});
