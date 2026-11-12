import { describe, it, expect } from 'vitest';
import { fraseDelFreno } from '@/lib/ordini/veloce-non-confermata';
import { veloceNonConfermataTemplate } from '@/lib/email/templates';

// R09-001 — Con più negozi nel carrello il freno sposta anche gli ordini che un negozio ha già
// accettato: quelli non si annullano più, e la frase non può lasciar credere il contrario.
describe('R09-001 · il freno non promette l’annullo degli ordini già confermati', () => {
  it('carrello misto: la frase dice che gli ordini già confermati non si annullano', () => {
    const f = fraseDelFreno({ fascia: 'Domani · 9:00–12:00', euro: 'compresa', totaleCents: 1800, giaConfermati: 1 });
    expect(f).toMatch(/già confermato non si annulla più/);
    // la chiusura «puoi annullarlo…» resta l'ultima frase
    expect(f.trim().endsWith('finché il negozio non lo conferma.')).toBe(true);
  });

  it('due ordini confermati: lo dice al plurale', () => {
    const f = fraseDelFreno({ fascia: 'Oggi · 18:00–19:30', euro: 'tolto-carta', totaleCents: 1800, giaConfermati: 2 });
    expect(f).toMatch(/I 2 ordini che i negozi hanno già confermato non si annullano più/);
  });

  it('un negozio solo: la frase non cambia', () => {
    const f = fraseDelFreno({ fascia: 'Domani · 9:00–12:00', euro: 'compresa', totaleCents: 1800 });
    expect(f).not.toMatch(/non si annull/);
  });

  it('anche l’email lo dice, e sostituisce solo la chiusura', () => {
    const frase = fraseDelFreno({ fascia: 'Domani · 9:00–12:00', euro: 'compresa', totaleCents: 1800, giaConfermati: 1 });
    const email = veloceNonConfermataTemplate({ orderId: 'abc', frase });
    const testo = JSON.stringify(email);
    expect(testo).toMatch(/già confermato non si annulla più/);
  });
});
