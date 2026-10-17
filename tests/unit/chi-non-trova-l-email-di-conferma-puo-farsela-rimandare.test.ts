/**
 * 15/10/2026 (R43) — CHI SI ISCRIVE E NON TROVA L'EMAIL DI CONFERMA NON RESTA
 * CHIUSO FUORI.
 *
 * Maria, 70 anni, si iscrive dal telefono; la conferma finisce nello spam.
 * Prima: la pagina «Verifica la tua email» diceva «a la tua email» col pulsante
 * «Reinvia» grigio (cercava l'email solo nella sessione, che con la conferma
 * accesa non c'e'), e il giorno dopo l'accesso con email e password giuste le
 * diceva «Email o password non corretti». Nessuna strada rimandava il link.
 *
 * Le prove seguono le due porte:
 *  ① l'accesso: «email non confermata» arriva come tale fino alla pagina, che
 *    porta alla verifica; la password sbagliata resta «password sbagliata»;
 *  ② la verifica: senza sessione il pulsante si accende appena c'e' un'email
 *    (lasciata dalla registrazione o scritta nel campo), il link si rimanda
 *    davvero, e «Esci» non compare a chi non e' mai entrato.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const accessoConPassword = vi.fn();
const uscita = vi.fn();
vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: {
    signIn: async (...args: unknown[]) => ({ ...(await accessoConPassword(...args)), client: { auth: { signOut: () => uscita() } } }),
  },
}));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
// L'accesso riuscito prova a scrivere il verbale: qui non c'entra, e il
// client amministrativo non esiste.
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => { throw new Error('non serve in questa prova'); },
}));

import { POST as accedi } from '@/app/api/auth/signin/route';
import {
  CHIAVE_EMAIL_DA_CONFERMARE,
  esitoDellaRispostaDiAccesso,
  leggiEmailDaConfermare,
  percorsoVerificaEmail,
  ricordaEmailDaConfermare,
  rimandaLinkDiConferma,
  vistaDellaVerifica,
} from '@/lib/auth/conferma-email';

let ipProgressivo = 0;
function richiestaDiAccesso(email: string, password: string): Request {
  ipProgressivo += 1;
  return new Request('https://mycity.test/api/auth/signin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.43.0.${ipProgressivo}` },
    body: JSON.stringify({ email, password }),
  });
}

/** Una memoria della scheda finta, come `sessionStorage`. */
function memoria() {
  const dati = new Map<string, string>();
  return {
    dati,
    getItem: (k: string) => dati.get(k) ?? null,
    setItem: (k: string, v: string) => { dati.set(k, v); },
  };
}

beforeEach(() => {
  accessoConPassword.mockReset();
  uscita.mockReset();
});

describe('① la porta dell’accesso', () => {
  it('IL CASO CHE ROMPEVA — password giusta, email non confermata: la risposta dice «da confermare», non «password sbagliata»', async () => {
    accessoConPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'email_not_confirmed', message: 'Email not confirmed', status: 400 },
    });
    const res = await accedi(richiestaDiAccesso('maria@esempio.it', 'password-giusta') as never);
    expect(res.status).toBe(403);
    const corpo = await res.json();
    expect(corpo.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(corpo.error.message).not.toMatch(/password non corrett/i);

    // E la pagina di accesso, con questa risposta, porta alla verifica.
    expect(esitoDellaRispostaDiAccesso(res.ok, corpo)).toEqual({ tipo: 'email-da-confermare' });
  });

  it('anche quando Supabase manda solo il messaggio, senza il codice', async () => {
    accessoConPassword.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Email not confirmed' } });
    const res = await accedi(richiestaDiAccesso('maria@esempio.it', 'password-giusta') as never);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('la password sbagliata resta «Email o password non corretti» (nessun indizio su chi è iscritto)', async () => {
    accessoConPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 },
    });
    const res = await accedi(richiestaDiAccesso('maria@esempio.it', 'password-sbagliata') as never);
    expect(res.status).toBe(401);
    const corpo = await res.json();
    expect(corpo.error.message).toMatch(/Email o password non corretti/);
    expect(esitoDellaRispostaDiAccesso(res.ok, corpo)).toEqual({ tipo: 'errore', messaggio: 'Email o password non corretti' });
  });

  it('la pagina di verifica riceve la strada di prima, solo se interna', () => {
    expect(percorsoVerificaEmail('/checkout')).toBe('/auth/verify-email?returnTo=%2Fcheckout');
    expect(percorsoVerificaEmail('//sito-truffa.it')).toBe('/auth/verify-email');
    expect(percorsoVerificaEmail(null)).toBe('/auth/verify-email');
  });
});

describe('② la pagina «Verifica la tua email», senza sessione', () => {
  it('IL CASO CHE ROMPEVA — appena iscritta: l’email lasciata dalla registrazione accende «Reinvia»', () => {
    const scheda = memoria();
    // La registrazione (o l'accesso respinto) la lascia…
    ricordaEmailDaConfermare(scheda, '  maria@esempio.it ');
    // …e la pagina di verifica la ritrova.
    const ricordata = leggiEmailDaConfermare(scheda);
    expect(ricordata).toBe('maria@esempio.it');

    const vista = vistaDellaVerifica({ emailDellaSessione: null, emailRicordata: ricordata, emailScritta: ricordata!, inCorso: false });
    expect(vista.puoReinviare, 'prima era sempre spento: disabled={resending || !email}').toBe(true);
    expect(vista.emailPerIlReinvio).toBe('maria@esempio.it');
    expect(vista.mostraEsci, '«Esci» per chi non è mai entrato non ha senso').toBe(false);
  });

  it('arrivata da sola, senza memoria: c’è il campo, e il pulsante si accende quando l’email è scritta', () => {
    const vuota = vistaDellaVerifica({ emailDellaSessione: null, emailRicordata: null, emailScritta: '', inCorso: false });
    expect(vuota.chiediEmail).toBe(true);
    expect(vuota.puoReinviare).toBe(false);

    const scritta = vistaDellaVerifica({ emailDellaSessione: null, emailRicordata: null, emailScritta: 'maria@esempio.it', inCorso: false });
    expect(scritta.puoReinviare).toBe(true);

    const storta = vistaDellaVerifica({ emailDellaSessione: null, emailRicordata: null, emailScritta: 'maria@', inCorso: false });
    expect(storta.puoReinviare).toBe(false);

    const inInvio = vistaDellaVerifica({ emailDellaSessione: null, emailRicordata: null, emailScritta: 'maria@esempio.it', inCorso: true });
    expect(inInvio.puoReinviare, 'mentre parte, non si preme due volte').toBe(false);
  });

  it('chi è entrato (sessione con email da confermare) usa l’email della sessione e vede «Esci»', () => {
    const vista = vistaDellaVerifica({ emailDellaSessione: 'luca@esempio.it', emailRicordata: 'altra@esempio.it', emailScritta: '', inCorso: false });
    expect(vista.emailPerIlReinvio).toBe('luca@esempio.it');
    expect(vista.chiediEmail).toBe(false);
    expect(vista.mostraEsci).toBe(true);
  });

  it('«Reinvia» rimanda davvero il link, senza sessione, e il link nuovo riporta al checkout', async () => {
    const resend = vi.fn(async () => ({ error: null }));
    const esito = await rimandaLinkDiConferma({ auth: { resend } }, {
      email: 'maria@esempio.it',
      base: 'https://mycity.test',
      returnTo: '/checkout',
    });
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'maria@esempio.it',
      options: { emailRedirectTo: `https://mycity.test/auth/callback?next=${encodeURIComponent('/checkout?registrazione=email')}` },
    });
    expect(esito.esito).toBe('inviato');
    expect(esito.messaggio).toMatch(/spam/);
  });

  it('se Supabase rifiuta (troppe email), il messaggio è in italiano e dice cosa fare', async () => {
    const resend = vi.fn(async () => ({ error: { message: 'Email rate limit exceeded' } }));
    const esito = await rimandaLinkDiConferma({ auth: { resend } }, { email: 'maria@esempio.it', base: 'https://mycity.test' });
    expect(esito.esito).toBe('errore');
    expect(esito.messaggio).toMatch(/troppe email/i);
  });

  it('con un’email che non sta in piedi non si chiama nemmeno Supabase', async () => {
    const resend = vi.fn(async () => ({ error: null }));
    const esito = await rimandaLinkDiConferma({ auth: { resend } }, { email: 'maria', base: 'https://mycity.test' });
    expect(resend).not.toHaveBeenCalled();
    expect(esito.esito).toBe('email-non-valida');
  });

  it('la memoria del browser che rifiuta (finestra privata) non rompe niente: si chiede l’email nel campo', () => {
    const rotta = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(() => ricordaEmailDaConfermare(rotta, 'maria@esempio.it')).not.toThrow();
    expect(leggiEmailDaConfermare(rotta)).toBeNull();
    expect(leggiEmailDaConfermare(null)).toBeNull();
  });

  it('nella memoria finisce solo un’email vera, sotto una chiave sola', () => {
    const scheda = memoria();
    ricordaEmailDaConfermare(scheda, 'non-una-email');
    expect(scheda.dati.size).toBe(0);
    ricordaEmailDaConfermare(scheda, 'maria@esempio.it');
    expect([...scheda.dati.keys()]).toEqual([CHIAVE_EMAIL_DA_CONFERMARE]);
  });
});
