import { describe, it, expect } from 'vitest';
import { incassoPerGiorno } from '@/lib/guadagni/giorni';
import { fraseAttesaBonifico, ORE_ATTESA_BONIFICO } from '@/lib/stripe/tempi-bonifico';

/**
 * 27/8/2026 (R174) — IL GRAFICO DEI GUADAGNI TAGLIAVA I GIORNI A GREENWICH.
 *
 * Le colonne e le date degli ordini si costruivano con
 * `toISOString().slice(0, 10)`, cioè la data di Greenwich. D'estate l'Italia è
 * due ore avanti: un ordine dell'una e mezza di notte del 4 agosto, a
 * Greenwich, è ancora del 3 — e finiva nella colonna sbagliata. Per un
 * marketplace che vende anche la sera tardi non è un caso raro.
 *
 * Il negoziante vedeva lo stesso ordine in due giorni diversi a seconda della
 * pagina che apriva, perché tutte le altre pagine dei numeri l'orologio di
 * casa lo usavano già.
 */
describe('le colonne del grafico dei guadagni', () => {
  it('un ordine dell una e mezza di notte sta nel giorno di Piacenza, non in quello di Greenwich', () => {
    // 3 agosto 2026, 23:30 a Greenwich = 4 agosto, 01:30 a Piacenza.
    const ordini = [{ created_at: '2026-08-03T23:30:00.000Z', total_price: 40 }];
    const adesso = new Date('2026-08-04T12:00:00.000Z');

    const giorni = Object.fromEntries(incassoPerGiorno(ordini, 7, adesso));

    expect(
      giorni['2026-08-04'],
      'l incasso della notte finisce nella colonna del giorno prima: due cruscotti che si contraddicono',
    ).toBe(40);
    expect(giorni['2026-08-03']).toBe(0);
  });

  it('tiene tutte e sette le colonne, anche i giorni senza ordini', () => {
    const giorni = incassoPerGiorno([], 7, new Date('2026-08-04T12:00:00.000Z'));
    expect(giorni.length).toBe(7);
    expect(giorni[6][0], 'l ultima colonna deve essere oggi').toBe('2026-08-04');
  });

  it('somma piu ordini dello stesso giorno', () => {
    const ordini = [
      { created_at: '2026-08-04T08:00:00.000Z', total_price: 10 },
      { created_at: '2026-08-04T18:00:00.000Z', total_price: '15' },
    ];
    const giorni = Object.fromEntries(incassoPerGiorno(ordini, 7, new Date('2026-08-04T20:00:00.000Z')));
    expect(giorni['2026-08-04']).toBe(25);
  });
});

/**
 * 27/8/2026 (R051) — IL TEMPO DEL BONIFICO ERA SCRITTO IN QUATTRO MODI.
 *
 * Il giro paga a consegna + un'ora; la pagina Guadagni diceva «~24 ore»; due
 * commenti dicevano «+3gg»; le domande frequenti dicevano «bonifico mensile il
 * giorno 5». Adesso il numero è uno solo e la frase mostrata al negoziante
 * nasce da quel numero: non possono più raccontare due cose diverse.
 */
describe('il tempo del bonifico detto al negoziante', () => {
  it('la frase dice quello che fa davvero il giro dei bonifici', () => {
    expect(ORE_ATTESA_BONIFICO).toBeGreaterThan(0);
    if (ORE_ATTESA_BONIFICO === 1) {
      expect(fraseAttesaBonifico()).toContain("un'ora");
    } else if (ORE_ATTESA_BONIFICO < 24) {
      expect(fraseAttesaBonifico()).toContain(`${ORE_ATTESA_BONIFICO} ore`);
    } else {
      expect(fraseAttesaBonifico()).toContain('giorn');
    }
  });

  it('non promette mai giorni quando si paga in ore', () => {
    if (ORE_ATTESA_BONIFICO < 24) {
      expect(
        fraseAttesaBonifico().includes('giorni'),
        'la pagina promette giorni mentre il bonifico parte in un ora: e la promessa su cui il negozio decide se restare',
      ).toBe(false);
    }
  });
});
