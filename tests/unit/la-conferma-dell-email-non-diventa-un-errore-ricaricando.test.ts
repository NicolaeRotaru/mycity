import { describe, it, expect } from 'vitest';
import { avvisoAlRitornoSullAccesso, indirizzoSenzaLaSessione } from '@/lib/auth/link-email';

/**
 * 16/10/2026 — GIULIA LEGGE «EMAIL CONFERMATA», RICARICA, E LEGGE «LINK ROTTO».
 *
 * Il link rimandato da «Reinvia» torna con la sessione nel frammento e senza
 * codice. La rotta di ritorno la manda su `/sign-in?error=missing_code`, e il
 * frammento viaggia con lei. La pagina di accesso, guardando il frammento, dice
 * giusto «la tua email è confermata». Poi toglie il frammento dalla barra — e
 * lasciava `error=missing_code`, che senza frammento vuol dire «il link non è
 * completo», in rosso. Alla prima ricarica la conferma diventava un errore.
 *
 * Qui si prova la funzione che calcola l'indirizzo pulito: quello che la pagina
 * dice dopo la ricarica deve essere quello che ha detto prima.
 */

const SESSIONE_DI_ISCRIZIONE = '#access_token=x&refresh_token=y&type=signup';

/** L'errore che resta nell'indirizzo pulito. */
function erroreRimasto(indirizzo: string): string | null {
  return new URLSearchParams(indirizzo.split('?')[1] ?? '').get('error');
}

describe('l’indirizzo che resta quando la pagina di accesso toglie la sessione dal frammento', () => {
  it('IL CASO CHE ROMPEVA — `missing_code` con la sessione diventa `email_confermata`, e il ritorno al checkout resta', () => {
    const pulito = indirizzoSenzaLaSessione(
      'missing_code',
      SESSIONE_DI_ISCRIZIONE,
      '/sign-in',
      '?error=missing_code&returnTo=%2Fcheckout',
    );
    expect(pulito).toBe('/sign-in?error=email_confermata&returnTo=%2Fcheckout');
    expect(avvisoAlRitornoSullAccesso(erroreRimasto(pulito!), '')).toEqual({
      tono: 'info',
      testo: 'La tua email è confermata. Ora accedi con la tua email e la password che hai scelto.',
    });
  });

  it('senza una sessione nel frammento non c’è niente da riscrivere', () => {
    expect(indirizzoSenzaLaSessione('missing_code', '', '/sign-in', '?error=missing_code')).toBeNull();
    expect(indirizzoSenzaLaSessione('missing_code', null, '/sign-in', '?error=missing_code')).toBeNull();
    // Il link scaduto torna con l'errore nel frammento, non con la sessione: la
    // ricarica tiene il frammento, e quindi anche l'avviso.
    expect(
      indirizzoSenzaLaSessione('missing_code', '#error=access_denied&error_code=otp_expired', '/sign-in', '?error=missing_code'),
    ).toBeNull();
  });

  it('un errore che non dipende dal frammento resta quello che era', () => {
    expect(
      indirizzoSenzaLaSessione('callback_failed', SESSIONE_DI_ISCRIZIONE, '/sign-in', '?error=callback_failed&returnTo=%2F'),
    ).toBe('/sign-in?error=callback_failed&returnTo=%2F');
    expect(indirizzoSenzaLaSessione(null, SESSIONE_DI_ISCRIZIONE, '/sign-in', '')).toBe('/sign-in');
    expect(indirizzoSenzaLaSessione(null, SESSIONE_DI_ISCRIZIONE, '/sign-in', '?returnTo=%2Fcheckout')).toBe(
      '/sign-in?returnTo=%2Fcheckout',
    );
  });

  it('per ogni errore e ogni frammento con la sessione, la pagina ricaricata dice la stessa cosa', () => {
    const errori = [
      null,
      'sconosciuto',
      'email_confermata',
      'link_scaduto',
      'link_non_valido',
      'callback_failed',
      'accesso_non_riuscito',
      'missing_code',
    ];
    const frammenti = [
      SESSIONE_DI_ISCRIZIONE,
      '#access_token=x&type=magiclink',
      '#refresh_token=y',
      '#access_token=x&refresh_token=y&type=recovery',
      '#access_token=x&refresh_token=y&type=signup&error=server_error',
    ];
    for (const errore of errori) {
      for (const frammento of frammenti) {
        const query = errore ? `?error=${errore}&returnTo=%2Fcheckout` : '?returnTo=%2Fcheckout';
        const pulito = indirizzoSenzaLaSessione(errore, frammento, '/sign-in', query);
        expect(pulito, `${errore} ${frammento}`).not.toBeNull();
        expect(pulito!.includes('#'), 'il gettone resta nella barra').toBe(false);
        expect(
          avvisoAlRitornoSullAccesso(erroreRimasto(pulito!), ''),
          `ricaricando dopo ${errore} ${frammento} la pagina cambia avviso`,
        ).toEqual(avvisoAlRitornoSullAccesso(errore, frammento));
        expect(new URLSearchParams(pulito!.split('?')[1]).get('returnTo')).toBe('/checkout');
      }
    }
  });
});
