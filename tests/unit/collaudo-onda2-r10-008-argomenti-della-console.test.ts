import { describe, it, expect } from 'vitest';
import { ripulisciEvento } from '@/lib/analytics/sentry-config';

/**
 * R10-008 (collaudo dell'onda 2, 28/11/2026) — LE BRICIOLE DELLA CONSOLE PORTAVANO ANCHE GLI ARGOMENTI GREZZI.
 *
 * La riparazione ripulisce `breadcrumbs[].message`. Ma l'SDK di Sentry (integrazione console di
 * @sentry/core e briciole del browser) scrive la briciola così:
 *   { category: 'console', message: <argomenti uniti>, data: { arguments: <argomenti com'erano>, logger: 'console' } }
 * Il messaggio usciva oscurato, `data.arguments` no: un `console.error('utente', email)` di una
 * libreria o di un componente mandava l'email in chiaro accanto alla sua copia oscurata.
 * Qui la briciola com'è fatta davvero, passata dalla pulizia vera.
 */
const EMAIL = 'mario.rossi@gmail.com';
const CELL = '3331234567';

function eventoConBricioleDellaConsole() {
  return {
    exception: { values: [{ type: 'Error', value: 'qualcosa è andato storto' }] },
    breadcrumbs: [
      {
        category: 'console',
        level: 'error',
        message: `utente ${EMAIL} telefono ${CELL}`,
        data: { arguments: ['utente', EMAIL, { telefono: CELL, email: EMAIL }], logger: 'console' },
      },
      { category: 'navigation', data: { from: '/', to: '/checkout' } },
    ],
  };
}

describe('R10-008 (collaudo) · le briciole della console non portano gli argomenti in chiaro', () => {
  it('niente email né telefono in tutta la briciola, argomenti compresi', () => {
    const tutto = JSON.stringify(ripulisciEvento(eventoConBricioleDellaConsole()).breadcrumbs);
    expect(tutto, 'l’email arriva a Sentry negli argomenti della briciola').not.toContain(EMAIL);
    expect(tutto, 'il telefono arriva a Sentry negli argomenti della briciola').not.toContain(CELL);
  });

  it('il messaggio oscurato resta, e anche il resto della briciola', () => {
    const [dellaConsole, navigazione] = ripulisciEvento(eventoConBricioleDellaConsole()).breadcrumbs;
    expect(dellaConsole.message).toMatch(/^utente .+ telefono .+$/);
    expect(dellaConsole.level).toBe('error');
    expect(dellaConsole.data.logger).toBe('console');
    expect(navigazione.data).toEqual({ from: '/', to: '/checkout' });
  });
});
