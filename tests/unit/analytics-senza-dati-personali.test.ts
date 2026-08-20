import { describe, it, expect } from 'vitest';
import { messaggioSenzaDatiPersonali } from '@/lib/analytics/events';

/**
 * `friendlyError()` mandava a PostHog il messaggio grezzo del database.
 *
 * Un errore di chiave duplicata di Postgres suona così: «duplicate key value
 * violates unique constraint "profiles_email_key" Key (email)=(mario@rossi.it)
 * already exists». Dentro c'è l'indirizzo di una persona, e finiva in un
 * sistema di analisi che di norma sta negli Stati Uniti e non è dichiarato per
 * contenere dati personali.
 *
 * Ogni prova qui sotto diventa rossa se si torna a passare il messaggio intero.
 */

describe('il messaggio che esce verso PostHog', () => {
  it("non porta l'email di nessuno", () => {
    const grezzo = 'duplicate key value violates unique constraint "profiles_email_key" Key (email)=(mario@rossi.it) already exists';
    const pulito = messaggioSenzaDatiPersonali(grezzo);
    expect(pulito).not.toContain('mario@rossi.it');
    expect(pulito).not.toContain('@');
  });

  it('non porta il contenuto della chiave in conflitto', () => {
    const pulito = messaggioSenzaDatiPersonali('Key (phone)=(+39 333 1234567) already exists');
    expect(pulito).not.toContain('333');
    expect(pulito).toContain('Key (…)=(…)');
  });

  it('non porta identificativi lunghi né numeri di telefono', () => {
    const pulito = messaggioSenzaDatiPersonali('order 8f14e45f-ceea-467a-9575-4a1b2c3d4e5f fallito per 3331234567');
    expect(pulito).toContain('<id>');
    expect(pulito).not.toContain('3331234567');
  });

  it('resta corto: è un raggruppamento, non un dump', () => {
    const lungo = 'errore '.repeat(50);
    expect(messaggioSenzaDatiPersonali(lungo).length).toBeLessThanOrEqual(40);
  });

  it('un messaggio senza dati personali passa leggibile', () => {
    expect(messaggioSenzaDatiPersonali('permission denied for table orders')).toBe('permission denied for table orders');
  });

  it('regge un messaggio vuoto', () => {
    expect(messaggioSenzaDatiPersonali('')).toBe('');
  });
});
