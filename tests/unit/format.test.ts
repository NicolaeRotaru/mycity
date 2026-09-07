/**
 * 6/9/2026 — QUESTA PROVA PRETENDEVA IL FORMATO SBAGLIATO.
 *
 * Fino a oggi qui c'era scritto `expect(formatPrice(10)).toBe('€10.00')`: la
 * prova difendeva il difetto invece del comportamento giusto. In italiano un
 * importo si scrive «10,00 €» — virgola per i decimali, simbolo dopo, punto
 * per le migliaia. Adesso è questo che la prova pretende, e se qualcuno
 * ricostruisce il prezzo a mano con `toFixed(2)` questa diventa rossa.
 *
 * Lo spazio prima dell'euro è U+00A0 (spazio unificatore): lo mette Intl e
 * serve a non far spezzare il prezzo a fine riga. È scritto ` ` apposta,
 * perché a occhio è identico a uno spazio normale.
 */
import { describe, it, expect } from 'vitest';
import { formatPrice, formatDate } from '@/lib/format';

const SPAZIO = ' '; // lo spazio unificatore fra la cifra e l'euro

describe('formatPrice — un importo si legge come lo scrive un italiano', () => {
  it('mette la virgola sui decimali e l’euro in fondo', () => {
    expect(formatPrice(10)).toBe(`10,00${SPAZIO}€`);
    expect(formatPrice(0)).toBe(`0,00${SPAZIO}€`);
    expect(formatPrice(9.99)).toBe(`9,99${SPAZIO}€`);
    expect(formatPrice(3.5)).toBe(`3,50${SPAZIO}€`);
  });

  it('separa le migliaia col punto, così «12345» non si legge a fatica', () => {
    expect(formatPrice(12345)).toBe(`12.345,00${SPAZIO}€`);
  });

  it('tiene attaccati cifra ed euro: il prezzo non si spezza a fine riga', () => {
    expect(formatPrice(129.9)).not.toContain(' €');
    expect(formatPrice(129.9)).toContain(`${SPAZIO}€`);
  });

  it('non scrive più il punto decimale all’inglese', () => {
    expect(formatPrice(1234.5)).not.toMatch(/\d\.\d{2}\b/);
    expect(formatPrice(1234.5)).not.toMatch(/^€/);
  });

  it('arrotonda ai centesimi', () => {
    expect(formatPrice(1.235)).toMatch(/^1,2[34] €$/);
  });

  it('accetta anche il numero scritto come testo', () => {
    expect(formatPrice('5.5')).toBe(`5,50${SPAZIO}€`);
    expect(formatPrice('10')).toBe(`10,00${SPAZIO}€`);
  });

  it('il rimborso resta negativo', () => {
    expect(formatPrice(-5)).toBe(`-5,00${SPAZIO}€`);
  });
});

describe('formatDate — la data in lettere', () => {
  it('scrive giorno, mese per esteso e anno', () => {
    expect(formatDate('2026-05-27')).toMatch(/27.*maggio.*2026/);
  });

  it('accetta un oggetto Date', () => {
    expect(formatDate(new Date('2026-01-15'))).toMatch(/15.*gennaio.*2026/);
  });

  it('niente zero davanti al giorno quando il mese è scritto per esteso', () => {
    // «03 settembre 2026» non si scrive: lo zero iniziale vale solo per 03/09/2026.
    expect(formatDate('2026-09-03')).toBe('3 settembre 2026');
    expect(formatDate('2026-05-03')).not.toMatch(/^03/);
  });
});
