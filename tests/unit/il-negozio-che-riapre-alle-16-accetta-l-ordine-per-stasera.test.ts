import { describe, it, expect } from 'vitest';
import {
  negozioPuoServire,
  motivoNegozioChiuso,
  leggiFinestraConsegna,
  leggiFasciaConsegna,
} from '@/lib/store-hours';
import {
  FASCE_AMMESSE,
  FASCE_DI_OGGI,
  FASCE_DI_DOMANI,
  ETICHETTA_ADESSO,
} from '@/lib/quando-arriva';

/**
 * LA PAUSA PRANZO RIFIUTAVA L'ORDINE PER STASERA.
 *
 * Il fornaio apre 7:00–13:00 e 16:00–19:30, come mezza Piacenza. Alle 14:00 il
 * cliente apre la cassa, sceglie «Stasera · 18:00–20:00» — una fascia che la
 * cassa gli propone lei — compila indirizzo e telefono, preme «Ordina» e legge
 * «è chiuso in questo momento». Alle 18:00 il negozio è aperto eccome.
 *
 * Il difetto era già stato riparato il 3/9 per «domani» e lasciato in piedi per
 * «oggi»: sullo stesso negozio chiuso il sito accettava l'ordine per domani
 * mattina e rifiutava quello per stasera.
 *
 * Qui si esegue la decisione, non si rilegge un testo.
 */

/** Le etichette vere, prese com'erano scritte. Se cambiano, questo test lo dice. */
const STASERA = 'Stasera · 18:00–20:00';
const IN_GIORNATA = 'In giornata · 15:00–18:00';
const DOMANI_MATTINA = 'Domani · 9:00–12:00';

/** Giovedì 3 settembre 2026. Le 14:00: il fornaio è in pausa fino alle 16. */
const giovediAlleDue = new Date('2026-09-03T14:00:00');
/** Lo stesso giovedì alle 21:15: la fascia delle 18–20 è passata. */
const giovediAlleNove = new Date('2026-09-03T21:15:00');

const orariFornaio: [string, string][] = [
  ['07:00', '13:00'],
  ['16:00', '19:30'],
];
const fornaio = {
  mon: orariFornaio,
  tue: orariFornaio,
  wed: orariFornaio,
  thu: orariFornaio,
  fri: orariFornaio,
  sat: orariFornaio,
  sun: orariFornaio,
} as unknown;

/** Aperto solo di mattina: nel pomeriggio non riapre affatto. */
const soloMattina = { thu: [['07:00', '13:00']], fri: [['07:00', '13:00']] } as unknown;

describe('le etichette di questa prova sono quelle vere della cassa', () => {
  it('tutte e tre stanno nell’elenco chiuso del server', () => {
    for (const e of [STASERA, IN_GIORNATA, DOMANI_MATTINA]) {
      expect(FASCE_AMMESSE, e).toContain(e);
    }
  });
});

describe('alle 14:00 il fornaio che riapre alle 16 accetta l’ordine per stasera', () => {
  it('«Stasera · 18:00–20:00» passa: alle 18 il negozio è aperto', () => {
    expect(negozioPuoServire(fornaio, STASERA, giovediAlleDue)).toBe(true);
  });

  it('e anche «In giornata · 15:00–18:00», che pesca la riapertura delle 16', () => {
    expect(negozioPuoServire(fornaio, IN_GIORNATA, giovediAlleDue)).toBe(true);
  });

  it('lo stesso negozio chiuso non risponde in due modi opposti su oggi e domani', () => {
    const perStasera = negozioPuoServire(fornaio, STASERA, giovediAlleDue);
    const perDomani = negozioPuoServire(fornaio, DOMANI_MATTINA, giovediAlleDue);
    expect(perStasera, 'oggi e domani devono decidere con la stessa domanda').toBe(perDomani);
    expect(perDomani).toBe(true);
  });
});

describe('il no resta un no quando è giusto, e dice il motivo vero', () => {
  it('negozio che nel pomeriggio non riapre: l’ordine per stasera si ferma', () => {
    expect(negozioPuoServire(soloMattina, STASERA, giovediAlleDue)).toBe(false);
  });

  it('e il motivo parla di OGGI in quella fascia, non dell’orologio né di domani', () => {
    const motivo = motivoNegozioChiuso('Il Fornaio', STASERA, giovediAlleDue);
    expect(motivo.toLowerCase()).toContain('oggi');
    expect(motivo.toLowerCase()).not.toContain('domani');
    expect(motivo.toLowerCase()).not.toContain('in questo momento');
  });

  it('una fascia già passata non si accetta, nemmeno da un negozio aperto adesso', () => {
    // Bar aperto fino alle 23: alle 21:15 è aperto, ma le 18–20 sono passate.
    const bar = { thu: [['16:00', '23:00']] } as unknown;
    expect(negozioPuoServire(bar, STASERA, giovediAlleNove)).toBe(false);
    expect(motivoNegozioChiuso('Il Bar', STASERA, giovediAlleNove).toLowerCase()).toContain(
      'passata',
    );
  });

  it('conta la parte di fascia che deve ancora venire, non quella già andata', () => {
    // Alle 17:50 la fascia 15–18 è quasi finita e il negozio ha chiuso alle 17:
    // nei dieci minuti che restano il fattorino andrebbe a vuoto.
    const chiudeAlleCinque = { thu: [['09:00', '17:00']] } as unknown;
    const alle1750 = new Date('2026-09-03T17:50:00');
    expect(negozioPuoServire(chiudeAlleCinque, IN_GIORNATA, alle1750)).toBe(false);
  });
});

describe('per «adesso» e per chi non sceglie niente, la regola resta l’orologio', () => {
  it('in pausa pranzo la consegna immediata si ferma', () => {
    expect(negozioPuoServire(fornaio, ETICHETTA_ADESSO, giovediAlleDue)).toBe(false);
    expect(negozioPuoServire(fornaio, null, giovediAlleDue)).toBe(false);
    expect(motivoNegozioChiuso('Il Fornaio', null, giovediAlleDue)).toContain('in questo momento');
  });

  it('a negozio aperto passa, come sempre', () => {
    expect(negozioPuoServire(fornaio, null, new Date('2026-09-03T10:00:00'))).toBe(true);
  });

  it('orari mai impostati: nessun blocco', () => {
    expect(negozioPuoServire(null, STASERA, giovediAlleDue)).toBe(true);
    expect(negozioPuoServire({ thu: [] }, STASERA, giovediAlleDue)).toBe(true);
  });
});

describe('una fascia che la cassa non propone non allarga niente', () => {
  it('nemmeno la stessa scritta col trattino corto invece di quello lungo', () => {
    // Il confronto è esatto: l'elenco del server è un cancello, non un indizio.
    expect(FASCE_AMMESSE).not.toContain('Stasera · 18:00-20:00');
    expect(negozioPuoServire(fornaio, 'Stasera · 18:00-20:00', giovediAlleDue)).toBe(false);
  });

  it('e la parola «stasera» da sola non apre la saracinesca', () => {
    for (const inventata of ['stasera', 'Stasera', 'oggi', 'Stasera · 0:00–24:00', 'domani']) {
      expect(negozioPuoServire(fornaio, inventata, giovediAlleDue), inventata).toBe(false);
    }
  });
});

describe('il giorno lo dice l’elenco, non una parola dentro l’etichetta', () => {
  it('ogni fascia che la cassa può proporre viene collocata: nessuna cade nel ripiego', () => {
    // È il freno contro il ritorno della malattia. Chi aggiunge una fascia in
    // `lib/quando-arriva.ts` senza insegnarla a chi decide trova rosso qui,
    // invece di un ordine rifiutato in cassa che nessuno collega alla causa.
    for (const etichetta of FASCE_AMMESSE) {
      const letta = leggiFinestraConsegna(etichetta);
      expect(letta, `«${etichetta}» non viene letta`).not.toBeNull();
      if (letta?.giorno === 'oggi' || letta?.giorno === 'domani') {
        expect(letta.aMinuti, etichetta).toBeGreaterThan(letta.daMinuti);
      }
    }
  });

  it('le due fasce di oggi sono OGGI, le quattro di domani sono DOMANI, l’express è ADESSO', () => {
    for (const f of FASCE_DI_OGGI) {
      expect(leggiFinestraConsegna(f.etichetta)?.giorno, f.etichetta).toBe('oggi');
    }
    for (const f of FASCE_DI_DOMANI) {
      expect(leggiFinestraConsegna(f)?.giorno, f).toBe('domani');
    }
    expect(leggiFinestraConsegna(ETICHETTA_ADESSO)?.giorno).toBe('adesso');
  });

  it('e il lettore vecchio continua a rispondere solo su domani, come prima', () => {
    // `leggiFasciaConsegna` è il contratto su cui contano le prove del 3/9.
    for (const f of FASCE_DI_DOMANI) {
      expect(leggiFasciaConsegna(f), f).not.toBeNull();
    }
    for (const f of FASCE_DI_OGGI) {
      expect(leggiFasciaConsegna(f.etichetta), f.etichetta).toBeNull();
    }
    expect(leggiFasciaConsegna(ETICHETTA_ADESSO)).toBeNull();
    expect(leggiFasciaConsegna('domani')).toBeNull();
  });
});
