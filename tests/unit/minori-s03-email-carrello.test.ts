import { describe, it, expect } from 'vitest';
import { righeDelCarrello, euro, type AvvisoDelCarrello } from '@/lib/email/annullo-nel-carrello';

/** S03 — le righe dell'email di annullo nel carrello (schede 2235, 2234, 2236). */
const nb = (s: string) => s.replace(/ /g, ' ');
const base: AvvisoDelCarrello = {
  ordineId: 'paneaaaa',
  pagatoCents: 1800,
  tornaCents: 1600,
  consegnaCents: 100,
  spesaCents: 1500,
  negoziRimasti: 1,
  rimasti: [{ ordineId: 'fruttaaa', consegnaPrimaCents: 100, consegnaCents: 300, totalePrimaCents: 1300, totaleCents: 1500 }],
};

describe('annullo nel carrello: cifre e frasi', () => {
  it('2235 — le cifre usano formatPrice: decimali e punto delle migliaia', () => {
    expect(nb(euro(1600))).toBe('16,00 €');
    expect(nb(euro(1234567))).toBe('12.345,67 €');
  });

  it('2234 — contanti: si nomina la cifra della conferma e il totale alla porta scende', () => {
    const t = nb(righeDelCarrello(base, 'contanti').join('\n'));
    expect(t).toMatch(/non paghi i suoi 18,00 € della conferma\./);
    expect(t).not.toMatch(/16,00 €/);
    expect(t).toMatch(/In tutto alla porta paghi 15,00 € invece di 31,00 €\./);
  });

  it('2234 — da pagare: il totale del carrello prima e dopo', () => {
    const t = nb(righeDelCarrello(base, 'da-pagare').join('\n'));
    expect(t).toMatch(/In tutto il carrello ora costa 15,00 € invece di 31,00 €\./);
  });

  it('2236 — se cambia solo il totale, la frase non dice «la consegna ora è 1 € invece di 1 €»', () => {
    const a = { ...base, rimasti: [{ ...base.rimasti[0], consegnaCents: 100, totaleCents: 1200 }] };
    const t = nb(righeDelCarrello(a, 'contanti').join('\n'));
    expect(t).not.toMatch(/consegna dell'ordine/);
    expect(t).toMatch(/Il totale dell'ordine #FRUTTA cambia: alla porta paghi 12,00 € invece di 13,00 €\./);
  });
});
