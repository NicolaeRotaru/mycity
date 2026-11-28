import { describe, it, expect } from 'vitest';
import { ripulisciEvento } from '@/lib/analytics/sentry-config';

/**
 * R10-008 (onda 2, 28/11/2026) — IL TESTO DI UN ERRORE VERO ARRIVAVA A SENTRY SENZA OSCURARE EMAIL E TELEFONI.
 *
 * Il logger oscura email e telefoni prima di chiamare Sentry. Ma gli errori che dal logger non
 * passano (onRequestError del server in instrumentation.ts, le pagine error.tsx, le promesse
 * rifiutate del browser, l'edge) arrivano a `ripulisciEvento` — il beforeSend di server, edge e
 * browser — col testo com'era: cookie, intestazioni e indirizzi si toglievano, il titolo
 * dell'errore no. Qui l'evento come lo costruisce l'SDK, passato dalla pulizia vera.
 */
const EMAIL = 'mario.rossi@gmail.com';
const CELL = '333 1234567';

function eventoDiErrore() {
  return {
    exception: {
      values: [
        { type: 'Error', value: `Nessun ordine per ${EMAIL}: telefono ${CELL} non valido` },
        { type: 'TypeError', value: `Cannot read properties of undefined (reading 'id') per +39 3331234567` },
      ],
    },
    message: `Richiesta fallita per ${EMAIL}`,
    logentry: { message: `chiamare il ${CELL}` },
    breadcrumbs: [{ category: 'console', message: `console.error: utente ${EMAIL}` }],
  };
}

describe('R10-008 · il testo dell’errore arriva a Sentry senza email né telefoni', () => {
  it('IL CASO DELLA VOCE — il valore dell’eccezione non porta email e telefono in chiaro', () => {
    const e = ripulisciEvento(eventoDiErrore());
    const tutto = JSON.stringify(e);
    expect(tutto, 'l’email arriva a Sentry nel titolo dell’errore').not.toContain(EMAIL);
    expect(tutto, 'il telefono arriva a Sentry nel titolo dell’errore').not.toContain(CELL);
    expect(tutto).not.toContain('3331234567');
  });

  it('il resto del testo resta leggibile: tipo, frase e proprietà mancante', () => {
    const e = ripulisciEvento(eventoDiErrore());
    expect(e.exception.values[0].type).toBe('Error');
    expect(e.exception.values[0].value).toMatch(/^Nessun ordine per .+: telefono .+ non valido$/);
    expect(e.exception.values[1].value).toContain("Cannot read properties of undefined (reading 'id')");
    expect(e.message).toMatch(/^Richiesta fallita per /);
    expect(e.breadcrumbs[0].message).toMatch(/^console\.error: utente /);
  });

  it('date, ore e numeri d’ordine non si toccano', () => {
    const testo = 'Ordine 4821 del 05/11/2026 alle 12:30 non trovato';
    const e = ripulisciEvento({ exception: { values: [{ type: 'Error', value: testo }] } });
    expect(e.exception.values[0].value).toBe(testo);
  });

  it('un evento senza eccezione né messaggio passa com’è', () => {
    expect(() => ripulisciEvento({})).not.toThrow();
    expect(ripulisciEvento({ exception: { values: [{ type: 'Error' }] } }).exception.values[0]).toEqual({ type: 'Error' });
  });
});
