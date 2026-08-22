import { describe, it, expect, vi } from 'vitest';
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

/**
 * 22/8/2026 — QUELLO CHE LE PERSONE SCRIVONO NELLA RICERCA PARTIVA COSI'
 * COM'E'.
 *
 * Nella casella di ricerca la gente non scrive solo «pane». Scrive il proprio
 * indirizzo email, il numero d'ordine, il telefono. Quel testo andava dritto
 * nel sistema di analisi, che sta negli Stati Uniti e non è dichiarato per
 * contenere dati personali.
 *
 * La pulizia esisteva già in quel file, scritta per gli errori. Alla ricerca
 * non era mai stata applicata. Queste prove diventano rosse se ci si torna.
 */
describe('quello che si scrive nella ricerca', () => {
  it("non porta l'email di chi cerca", async () => {
    const inviati: Array<{ nome: string; props: Record<string, unknown> }> = [];
    vi.doMock('@/lib/analytics/posthog', () => ({
      track: (nome: string, props: Record<string, unknown>) => inviati.push({ nome, props }),
    }));
    vi.resetModules();
    const { trackSearchPerformed } = await import('@/lib/analytics/events');

    trackSearchPerformed('ordine di mario.rossi@gmail.com', 3);

    const evento = inviati.find((e) => e.nome === 'search_performed');
    expect(evento, "l'evento di ricerca non è partito").toBeTruthy();
    expect(String(evento?.props.query)).not.toContain('mario.rossi@gmail.com');
    expect(String(evento?.props.query)).not.toContain('@');
    // Il numero di risultati è la parte utile: quella deve arrivare intera.
    expect(evento?.props.result_count).toBe(3);
    vi.doUnmock('@/lib/analytics/posthog');
    vi.resetModules();
  });

  it('una ricerca normale arriva leggibile', async () => {
    const inviati: Array<{ nome: string; props: Record<string, unknown> }> = [];
    vi.doMock('@/lib/analytics/posthog', () => ({
      track: (nome: string, props: Record<string, unknown>) => inviati.push({ nome, props }),
    }));
    vi.resetModules();
    const { trackSearchPerformed } = await import('@/lib/analytics/events');

    trackSearchPerformed('pane di segale', 12);

    expect(inviati.find((e) => e.nome === 'search_performed')?.props.query).toBe('pane di segale');
    vi.doUnmock('@/lib/analytics/posthog');
    vi.resetModules();
  });
});
