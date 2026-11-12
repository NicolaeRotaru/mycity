/**
 * R06-019 (12/11/2026) — LA RETE GUARDAVA GLI INDIRIZZI, NON UN DATO PERSONALE NUDO.
 *
 * `testoSenzaIndirizzi` usciva subito se il testo non conteneva una barra: un'email
 * o un telefono in una proprieta' qualunque passavano intatti verso PostHog.
 */
import { describe, it, expect } from 'vitest';
import { testoSenzaIndirizzi, strutturaSenzaIndirizzi } from '@/lib/analytics/filmato-senza-dati-personali';
import { eventoSenzaDatiPersonali } from '@/lib/analytics/posthog';

describe('R06-019 · email e telefoni nudi', () => {
  for (const [nome, testo, dato] of [
    ['email', 'contatto mario.rossi@gmail.com', 'mario.rossi@gmail.com'],
    ['cellulare attaccato', 'chiama 3331234567', '3331234567'],
    ['cellulare con spazi', 'chiama 333 123 4567', '333 123 4567'],
    ['cellulare con +39', '+39 333 123 45 67', '333 123 45 67'],
    ['fisso', 'negozio 0523 000000', '0523 000000'],
    ['fisso con la barra', 'tel 0532/123456', '0532/123456'],
    ['cellulare con la barra', 'tel 333/1234567', '333/1234567'],
    ['cellulare fra parentesi', '(333) 1234567', '1234567'],
    ['prefisso 0039 attaccato', '0039333123456', '333123456'],
    ['prefisso 0039 con spazi', '0039 333 1234567', '1234567'],
  ] as const) {
    it(`${nome}: nascosto`, () => {
      const pulito = testoSenzaIndirizzi(testo);
      expect(pulito, `passato intatto: ${pulito}`).not.toContain(dato);
    });
  }

  for (const [nome, testo] of [
    ['uuid', '04512345-1234-4abc-8def-0123456789ab'],
    ['data', '2026-11-12T08:30:00Z'],
    ['importo in centesimi', '12500'],
    ['percorso', '/product/abc'],
    ['passo della cassa', 'indirizzo'],
    ['codice ordine', '#A1B2C3'],
    ['data con i punti', '05.11.2026'],
    ['data con i trattini', '05-11-2026'],
    ['decimale', '314.15926'],
    ['pacchetto con versione', 'react@18.3.1'],
    ['percorso con un numero lungo', '/negozio/3331234567'],
    ['uuid tutto numerico', '33312345-6789-4123-8123-456789012345'],
  ] as const) {
    it(`${nome}: resta com'e'`, () => {
      expect(testoSenzaIndirizzi(testo)).toBe(testo);
    });
  }

  it('in un evento qualunque (trackCheckoutStep con proprieta\' in piu\') l\'email non parte', () => {
    const evento = eventoSenzaDatiPersonali({
      uuid: 'e1',
      event: 'checkout_step',
      properties: { step: 'indirizzo', nota: 'scrivetemi a mario.rossi@gmail.com', telefono: '333 123 4567' },
    } as never);
    const testo = JSON.stringify(evento);
    expect(testo).not.toContain('mario.rossi@gmail.com');
    expect(testo).not.toContain('333 123 4567');
    expect(testo).toContain('indirizzo');
  });

  it('dentro una struttura annidata', () => {
    expect(JSON.stringify(strutturaSenzaIndirizzi({ a: [{ b: 'tel 3331234567' }] }))).not.toContain('3331234567');
  });
});
