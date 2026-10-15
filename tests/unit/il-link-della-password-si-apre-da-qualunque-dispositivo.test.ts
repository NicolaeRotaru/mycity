/**
 * 15/10/2026 (R13) — CHI CHIEDE LA NUOVA PASSWORD DAL COMPUTER E APRE L'EMAIL DAL
 * TELEFONO DEVE POTERLA CAMBIARE. E SE UN LINK NON PUO' FUNZIONARE, LA PAGINA LO DICE.
 *
 * Il meccanismo vero, rifatto qui com'e': con il flusso PKCE, il `code` del link
 * si scambia con una sessione SOLO se la richiesta porta anche il cookie
 * `…-code-verifier`, che sta nel browser che ha chiesto il link. «Un altro
 * dispositivo» = una richiesta senza quel cookie. Il finto Supabase qui sotto si
 * comporta cosi': `exchangeCodeForSession` fallisce senza il cookie, mentre
 * `verifyOtp` con il `token_hash` non ne ha bisogno — come quello vero.
 *
 * Le prove:
 *  ① Lucia apre il link della password dal telefono (nessun cookie del
 *    computer): /auth/confirm le apre la sessione e la porta a /reset-password.
 *  ② Il link scaduto o rotto non finisce in una pagina muta: porta il motivo.
 *  ③ La conferma dell'iscrizione da un altro dispositivo: sessione, ritorno
 *    alla strada di prima, e il verbale di Termini e Informativa scritto.
 *  ④ I link di OGGI (/auth/callback?code=) restano in servizio: nello stesso
 *    browser funzionano come prima; da un altro dispositivo la pagina di
 *    accesso dice «email confermata, ora accedi» invece di niente.
 *  ⑤ /reset-password con un `?code=` che qui non puo' funzionare spiega perche'.
 *  ⑥ Chi entra poi con la password lascia il verbale che il ritorno fallito
 *    non aveva scritto.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const APP = 'https://mycity.test';

vi.mock('@/lib/env', () => ({
  env: { appUrl: () => 'https://mycity.test' },
  requireSupabasePublic: () => ({ url: 'https://progetto.supabase.test', key: 'chiave-anonima' }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

/* ------------------------------------------------------------------ */
/* Il database finto: profili e verbale delle accettazioni.             */
/* ------------------------------------------------------------------ */
type Profilo = { tos_accepted_at: string | null };
const profili = new Map<string, Profilo>();
const verbale: Record<string, unknown>[] = [];

const adminFinto = {
  from(tabella: string) {
    if (tabella === 'profiles') {
      return {
        select: () => ({
          eq: (_c: string, id: string) => ({
            maybeSingle: async () => ({ data: profili.get(id) ?? null, error: null }),
          }),
        }),
        update: (campi: Partial<Profilo>) => ({
          eq: async (_c: string, id: string) => {
            const p = profili.get(id);
            if (p) Object.assign(p, campi);
            return { error: null };
          },
        }),
      };
    }
    if (tabella === 'consent_log') {
      return {
        insert: async (riga: Record<string, unknown>) => {
          verbale.push(riga);
          return { error: null };
        },
      };
    }
    throw new Error(`tabella inattesa: ${tabella}`);
  },
};

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => adminFinto,
}));

/* ------------------------------------------------------------------ */
/* Il Supabase finto, con il meccanismo vero del code verifier.         */
/* ------------------------------------------------------------------ */
type Utente = { id: string; email: string; created_at: string; user_metadata: Record<string, unknown>; app_metadata: Record<string, unknown> };
/** I token_hash validi: un link che non e' qui e' scaduto o gia' usato. */
const linkValidi = new Map<string, Utente>();
/** I codici PKCE emessi da Supabase dopo la verifica del link. */
const codiciValidi = new Map<string, Utente>();
const COOKIE_SESSIONE = 'sb-progetto-auth-token';
const COOKIE_VERIFICATORE = 'sb-progetto-auth-token-code-verifier';
const chiamateVerifyOtp: Array<{ token_hash: string; type: string }> = [];

type Cookies = {
  get(nome: string): string | undefined;
  set(nome: string, valore: string, opzioni: Record<string, unknown>): void;
};

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, { cookies }: { cookies: Cookies }) => ({
    auth: {
      async verifyOtp(p: { token_hash: string; type: string }) {
        chiamateVerifyOtp.push(p);
        const utente = linkValidi.get(p.token_hash);
        if (!utente) {
          return { data: { user: null, session: null }, error: { code: 'otp_expired', message: 'Email link is invalid or has expired' } };
        }
        linkValidi.delete(p.token_hash); // un link vale una volta
        cookies.set(COOKIE_SESSIONE, `sessione-di-${utente.id}`, { path: '/' });
        return { data: { user: utente, session: { access_token: 'a', refresh_token: 'r' } }, error: null };
      },
      async exchangeCodeForSession(code: string) {
        // Come la libreria vera: senza la meta' segreta del browser di
        // partenza, lo scambio non parte nemmeno.
        if (!cookies.get(COOKIE_VERIFICATORE)) {
          return { data: { user: null, session: null }, error: { code: 'pkce_code_verifier_not_found', message: 'PKCE code verifier not found in storage.' } };
        }
        const utente = codiciValidi.get(code);
        if (!utente) return { data: { user: null, session: null }, error: { code: 'flow_state_not_found', message: 'invalid flow state' } };
        cookies.set(COOKIE_SESSIONE, `sessione-di-${utente.id}`, { path: '/' });
        return { data: { user: utente, session: { access_token: 'a', refresh_token: 'r' } }, error: null };
      },
    },
  }),
}));

/* L'accesso con la password: Supabase risponde con la persona e i suoi dati. */
const accessoConPassword = vi.fn();
vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: {
    signIn: async (...args: unknown[]) => ({ ...(await accessoConPassword(...args)), client: { auth: { signOut: async () => {} } } }),
  },
}));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));

import { GET as conferma } from '@/app/auth/confirm/route';
import { POST as accedi } from '@/app/api/auth/signin/route';
import { GET as ritorno } from '@/app/auth/callback/route';
import {
  SPIEGAZIONE_RESET,
  avvisoAlRitornoSullAccesso,
  motivoLinkPasswordSenzaSessione,
  percorsoDiRitorno,
} from '@/lib/auth/link-email';
import { TETTO_VERBALE_MS, verbalizzaAccettazione } from '@/lib/auth/accettazione-testi';
import { ritornoDopoLaConferma } from '@/lib/analytics/porta-di-ingresso';

function richiesta(percorso: string, cookie?: Record<string, string>): NextRequest {
  const headers = new Headers({ 'user-agent': 'telefono-di-lucia', 'x-forwarded-for': '5.6.7.8' });
  if (cookie) headers.set('cookie', Object.entries(cookie).map(([k, v]) => `${k}=${v}`).join('; '));
  return new NextRequest(`${APP}${percorso}`, { headers });
}

function dove(res: Response): URL {
  const l = res.headers.get('location');
  if (!l) throw new Error(`nessun rimando (stato ${res.status})`);
  return new URL(l);
}

function sessioneScritta(res: Response): string | undefined {
  const tutti = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
  return tutti.find((c) => c.startsWith(`${COOKIE_SESSIONE}=`) && !c.startsWith(`${COOKIE_SESSIONE}=;`));
}

function utente(id: string, metadati: Record<string, unknown> = {}): Utente {
  return { id, email: `${id}@esempio.it`, created_at: '2026-10-01T10:00:00Z', user_metadata: metadati, app_metadata: { provider: 'email' } };
}

beforeEach(() => {
  linkValidi.clear();
  codiciValidi.clear();
  profili.clear();
  verbale.length = 0;
  chiamateVerifyOtp.length = 0;
});

describe('① Lucia chiede la password dal computer e apre l’email dal telefono', () => {
  it('IL CASO CHE ROMPEVA — il link col token_hash apre la sessione senza nessun cookie del computer', async () => {
    linkValidi.set('pkce_8f3a1c9e2b7d4e6f', utente('lucia'));

    // Nessun cookie: e' il telefono, non il computer che ha chiesto il link.
    const res = await conferma(richiesta('/auth/confirm?token_hash=pkce_8f3a1c9e2b7d4e6f&type=recovery'));

    expect(chiamateVerifyOtp).toEqual([{ token_hash: 'pkce_8f3a1c9e2b7d4e6f', type: 'recovery' }]);
    expect(dove(res).pathname, 'il link della password deve portare alla pagina della nuova password').toBe('/reset-password');
    expect(dove(res).origin).toBe(APP);
    expect(sessioneScritta(res), 'senza la sessione nei cookie la pagina richiederebbe di nuovo l’email').toBeTruthy();
  });

  it('un `next` messo nel link non sposta chi cambia la password: va sempre a /reset-password', async () => {
    linkValidi.set('pkce_aaaaaaaabbbbbbbb', utente('lucia'));
    const res = await conferma(richiesta('/auth/confirm?token_hash=pkce_aaaaaaaabbbbbbbb&type=recovery&next=https://sito-truffa.it/x'));
    expect(dove(res).origin).toBe(APP);
    expect(dove(res).pathname).toBe('/reset-password');
  });
});

describe('② un link che non funziona non porta mai a una pagina muta', () => {
  it('link della password scaduto o già usato → torna alla pagina della password col motivo, senza sessione', async () => {
    const res = await conferma(richiesta('/auth/confirm?token_hash=pkce_scadutoscaduto&type=recovery'));
    expect(dove(res).pathname).toBe('/reset-password');
    expect(dove(res).searchParams.get('errore')).toBe('link_scaduto');
    expect(sessioneScritta(res)).toBeUndefined();
    // E la pagina sa cosa dire con quel motivo.
    expect(motivoLinkPasswordSenzaSessione(dove(res).searchParams)).toBe('link-scaduto');
  });

  it('link spezzato (niente token) → non si chiama nemmeno Supabase, e il motivo arriva alla pagina', async () => {
    const res = await conferma(richiesta('/auth/confirm?type=recovery'));
    expect(chiamateVerifyOtp).toHaveLength(0);
    expect(dove(res).searchParams.get('errore')).toBe('link_non_valido');
    expect(motivoLinkPasswordSenzaSessione(dove(res).searchParams)).toBe('link-non-valido');
  });

  it('un token con caratteri estranei non è un link nostro', async () => {
    const res = await conferma(richiesta('/auth/confirm?token_hash=abc%27%3B--drop&type=signup'));
    expect(chiamateVerifyOtp).toHaveLength(0);
    expect(dove(res).pathname).toBe('/sign-in');
    expect(dove(res).searchParams.get('error')).toBe('link_non_valido');
  });
});

describe('③ la conferma dell’iscrizione da un altro dispositivo', () => {
  it('apre la sessione, torna al checkout col segnale d’iscrizione e mette a verbale i testi accettati', async () => {
    linkValidi.set('pkce_conferma123456', utente('maria', { versione_testi_accettati: '2026-09-01' }));
    profili.set('maria', { tos_accepted_at: null });
    // Il modello dell'email passa `{{ .RedirectTo }}`: un indirizzo intero che
    // punta alla vecchia porta, con il `next` vero dentro.
    const redirectTo = `${APP}/auth/callback?next=${encodeURIComponent('/checkout?registrazione=email')}`;
    const res = await conferma(
      richiesta(`/auth/confirm?token_hash=pkce_conferma123456&type=signup&next=${encodeURIComponent(redirectTo)}`),
    );

    const arrivo = dove(res);
    expect(arrivo.pathname).toBe('/checkout');
    expect(arrivo.searchParams.get('registrazione')).toBe('email');
    expect(arrivo.searchParams.get('auth')).toBe('signup');
    expect(sessioneScritta(res)).toBeTruthy();
    expect(verbale, 'chi conferma da qui deve lasciare la riga di Termini e Informativa').toHaveLength(1);
    expect(verbale[0]).toMatchObject({ user_id: 'maria', categoria: 'privacy_terms', versione_testo: '2026-09-01', ip: '5.6.7.8' });
    expect(profili.get('maria')!.tos_accepted_at).toBeTruthy();
  });

  it('il ritorno con una domanda dentro (/checkout?passo=2) arriva intero, comunque il modello scriva RedirectTo', async () => {
    // Collaudo del 15/10: se Supabase mette `{{ .RedirectTo }}` nel link senza codificarlo,
    // la `&` del `next` di dentro lo spezzava e il segnale dell'iscrizione si perdeva.
    const redirectTo = ritornoDopoLaConferma(APP, '/checkout?passo=2', 'email');
    const forme = {
      grezza: `/auth/confirm?token_hash=pkce_grezzagrezza1&type=signup&next=${redirectTo}`,
      codificata: `/auth/confirm?token_hash=pkce_codificata12&type=signup&next=${encodeURIComponent(redirectTo)}`,
    };
    linkValidi.set('pkce_grezzagrezza1', utente('gina'));
    linkValidi.set('pkce_codificata12', utente('gino'));
    profili.set('gina', { tos_accepted_at: '2026-10-01T10:00:00Z' });
    profili.set('gino', { tos_accepted_at: '2026-10-01T10:00:00Z' });
    for (const [forma, link] of Object.entries(forme)) {
      const arrivo = dove(await conferma(richiesta(link)));
      expect(arrivo.pathname, `forma ${forma}`).toBe('/checkout');
      expect(arrivo.searchParams.get('passo'), `forma ${forma}: la domanda del checkout si è persa`).toBe('2');
      expect(arrivo.searchParams.get('registrazione'), `forma ${forma}: il segnale dell’iscrizione si è perso`).toBe('email');
    }
    // Il pezzo in chiaro passa comunque dal filtro dei percorsi interni.
    expect(percorsoDiRitorno(`${APP}/auth/callback?next=//sito-truffa.it/x&y=1`)).toBe('/');
  });

  it('senza versione dei testi e senza accettazione → chiede l’accettazione, CON la sessione addosso', async () => {
    linkValidi.set('pkce_senzaversione1', utente('pino'));
    profili.set('pino', { tos_accepted_at: null });
    const res = await conferma(richiesta('/auth/confirm?token_hash=pkce_senzaversione1&type=signup'));
    expect(dove(res).pathname).toBe('/accetta-condizioni');
    expect(sessioneScritta(res), 'senza cookie, la pagina che chiede l’accettazione troverebbe una persona non entrata').toBeTruthy();
  });
});

describe('④ i link di oggi (/auth/callback?code=) restano in servizio', () => {
  const next = encodeURIComponent('/checkout?registrazione=email');

  it('nello stesso browser (col cookie del verificatore) funzionano come prima', async () => {
    codiciValidi.set('codice-1', utente('anna', { versione_testi_accettati: '2026-09-01' }));
    profili.set('anna', { tos_accepted_at: null });
    const res = await ritorno(richiesta(`/auth/callback?code=codice-1&next=${next}`, { [COOKIE_VERIFICATORE]: 'meta-segreta' }));
    expect(dove(res).pathname).toBe('/checkout');
    expect(sessioneScritta(res)).toBeTruthy();
    expect(verbale).toHaveLength(1);
  });

  it('IL CASO CHE ROMPEVA — da un altro dispositivo la pagina di accesso dice «email confermata, ora accedi»', async () => {
    codiciValidi.set('codice-2', utente('anna'));
    const res = await ritorno(richiesta(`/auth/callback?code=codice-2&next=${next}`));
    const arrivo = dove(res);
    expect(arrivo.pathname).toBe('/sign-in');
    expect(arrivo.searchParams.get('returnTo'), 'dopo l’accesso si torna al checkout').toBe('/checkout?registrazione=email');
    const avviso = avvisoAlRitornoSullAccesso(arrivo.searchParams.get('error'), '');
    expect(avviso, 'la pagina di accesso non deve tacere').not.toBeNull();
    expect(avviso!.testo).toMatch(/email è confermata/i);
    expect(avviso!.testo).toMatch(/accedi/i);
  });

  it('se Supabase dice «link scaduto», la pagina lo dice (non «email confermata»)', async () => {
    const res = await ritorno(richiesta('/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid'));
    const avviso = avvisoAlRitornoSullAccesso(dove(res).searchParams.get('error'), '');
    expect(avviso!.testo).toMatch(/scaduto/i);
    expect(avviso!.testo).not.toMatch(/è confermata/i);
  });

  it('un accesso con Google andato storto non viene raccontato come «email confermata»', async () => {
    const res = await ritorno(richiesta('/auth/callback?code=codice-x&versione=2026-09-01'));
    const avviso = avvisoAlRitornoSullAccesso(dove(res).searchParams.get('error'), '');
    expect(avviso).not.toBeNull();
    expect(avviso!.testo).not.toMatch(/confermata/i);
  });

  it('chi annulla su Google non legge «il link è scaduto»: non ha aperto nessun link', async () => {
    // Collaudo del 15/10: Supabase torna con `versione` (la mette il pulsante Google) e
    // `error=access_denied`. Prima del lotto la pagina restava muta; con il primo giro
    // diceva una cosa falsa, «il link che hai aperto è scaduto o è già stato usato».
    const res = await ritorno(
      richiesta('/auth/callback?versione=2026-08-22&error=access_denied&error_code=access_denied&error_description=The+user+denied+access'),
    );
    const avviso = avvisoAlRitornoSullAccesso(dove(res).searchParams.get('error'), '');
    expect(avviso, 'a chi torna da Google la pagina non dice niente').not.toBeNull();
    expect(avviso!.testo).not.toMatch(/link/i);
    expect(avviso!.testo).toMatch(/non è andato a buon fine/);
    // E senza codice né errore (un ritorno da Google monco) non si parla di link incompleti.
    const monco = await ritorno(richiesta('/auth/callback?versione=2026-08-22'));
    expect(avvisoAlRitornoSullAccesso(dove(monco).searchParams.get('error'), '')!.testo).not.toMatch(/link/i);
  });

  it('chi entra dal ritorno senza aver mai accettato va a /accetta-condizioni CON la sessione', async () => {
    codiciValidi.set('codice-3', utente('vecchio'));
    profili.set('vecchio', { tos_accepted_at: null });
    const res = await ritorno(richiesta('/auth/callback?code=codice-3', { [COOKIE_VERIFICATORE]: 'meta-segreta' }));
    expect(dove(res).pathname).toBe('/accetta-condizioni');
    expect(sessioneScritta(res)).toBeTruthy();
  });

  it('il vecchio nome dell’errore (callback_failed), se salvato da qualche parte, ha comunque una spiegazione', () => {
    const avviso = avvisoAlRitornoSullAccesso('callback_failed', '');
    expect(avviso).not.toBeNull();
    expect(avviso!.testo).toMatch(/già confermata/i);
  });

  it('il link rimandato che porta la sessione nel frammento (#access_token…&type=signup) = email confermata', () => {
    const avviso = avvisoAlRitornoSullAccesso('missing_code', '#access_token=x&refresh_token=y&type=signup');
    expect(avviso!.testo).toMatch(/email è confermata/i);
    expect(avvisoAlRitornoSullAccesso('missing_code', '#error=access_denied&error_code=otp_expired')!.testo).toMatch(/scaduto/i);
  });

  it('senza errore nell’indirizzo, nessun avviso', () => {
    expect(avvisoAlRitornoSullAccesso(null, '')).toBeNull();
    expect(avvisoAlRitornoSullAccesso('qualcosa-di-inventato', '')).toBeNull();
  });
});

describe('⑤ /reset-password con un link che qui non può funzionare spiega perché', () => {
  it('IL CASO CHE ROMPEVA — `?code=` senza sessione: dice di aprirlo nel browser di partenza o di chiederne uno qui', () => {
    const motivo = motivoLinkPasswordSenzaSessione(new URLSearchParams('code=1b2c3d4e'), '');
    expect(motivo, 'prima: nessun motivo, e la pagina chiedeva di nuovo l’email in silenzio').toBe('altro-browser');
    expect(SPIEGAZIONE_RESET[motivo!].testo).toMatch(/browser da cui l’hai chiesto/);
    expect(SPIEGAZIONE_RESET[motivo!].testo).toMatch(/link nuovo/);
  });

  it('il link scaduto (anche quando Supabase lo dice nel frammento) ha la sua spiegazione', () => {
    expect(motivoLinkPasswordSenzaSessione(new URLSearchParams(''), '#error=access_denied&error_code=otp_expired')).toBe('link-scaduto');
    expect(motivoLinkPasswordSenzaSessione(new URLSearchParams('error_code=otp_expired'), '')).toBe('link-scaduto');
  });

  it('chi arriva per chiedere il link, senza averne aperto uno, non riceve spiegazioni inutili', () => {
    expect(motivoLinkPasswordSenzaSessione(new URLSearchParams(''), '')).toBeNull();
  });
});

describe('il ritorno resta sempre in casa nostra', () => {
  it('di un indirizzo intero si tiene solo il percorso, e una porta d’ingresso si apre fino al `next` vero', () => {
    expect(percorsoDiRitorno('https://sito-truffa.it/pagina')).toBe('/pagina');
    expect(percorsoDiRitorno(`${APP}/auth/callback?next=%2Fcheckout`)).toBe('/checkout');
    expect(percorsoDiRitorno('/auth/callback?next=//sito-truffa.it')).toBe('/');
    expect(percorsoDiRitorno('https://sito-truffa.it//altro-sito.it')).toBe('/');
    expect(percorsoDiRitorno('/\t/sito-truffa.it')).toBe('/');
    expect(percorsoDiRitorno(null)).toBe('/');
  });
});

describe('⑥ chi entra poi con la password lascia il verbale che il ritorno fallito non aveva scritto', () => {
  function accesso(ip: string) {
    return new Request(`${APP}/api/auth/signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': 'computer-di-anna' },
      body: JSON.stringify({ email: 'anna@esempio.it', password: 'password-giusta' }),
    });
  }

  it('IL CASO CHE ROMPEVA — conferma fallita sul telefono, accesso col computer: la riga si scrive, una volta sola', async () => {
    const anna = { ...utente('anna', { versione_testi_accettati: '2026-09-01' }), email_confirmed_at: '2026-10-01T10:05:00Z' };
    profili.set('anna', { tos_accepted_at: null });
    accessoConPassword.mockResolvedValue({ data: { user: anna, session: { access_token: 'a', refresh_token: 'r' } }, error: null });

    const primo = await accedi(accesso('7.7.7.1') as never);
    expect(primo.status).toBe(200);
    expect(verbale, 'chi entra con la password dopo un ritorno fallito restava senza verbale').toHaveLength(1);
    expect(verbale[0]).toMatchObject({ user_id: 'anna', versione_testo: '2026-09-01', user_agent: 'computer-di-anna' });

    const secondo = await accedi(accesso('7.7.7.2') as never);
    expect(secondo.status).toBe(200);
    expect(verbale, 'il verbale si scrive al primo accesso, non a ogni accesso').toHaveLength(1);
  });

  it('se il verbale non si può scrivere, l’accesso non si blocca', async () => {
    const anna = { ...utente('anna', { versione_testi_accettati: '2026-09-01' }), email_confirmed_at: '2026-10-01T10:05:00Z' };
    accessoConPassword.mockResolvedValue({ data: { user: anna, session: { access_token: 'a', refresh_token: 'r' } }, error: null });
    const guasto = vi.spyOn(adminFinto, 'from').mockImplementation(() => { throw new Error('database giù'); });
    const res = await accedi(accesso('7.7.7.3') as never);
    guasto.mockRestore();
    expect(res.status).toBe(200);
  });

  it('se la riga del verbale non entra, il profilo NON viene segnato «accettato»', async () => {
    // Collaudo del 15/10: una spunta senza la riga che la prova è una prova legale falsa.
    profili.set('rosa', { tos_accepted_at: null });
    const veroFrom = adminFinto.from.bind(adminFinto);
    const guasto = vi.spyOn(adminFinto, 'from').mockImplementation((tabella: string) => {
      if (tabella === 'consent_log') return { insert: async () => ({ error: { message: 'permission denied for table consent_log' } }) } as never;
      return veroFrom(tabella);
    });
    const esito = await verbalizzaAccettazione(adminFinto, { utenteId: 'rosa', versione: '2026-09-01', ip: null, userAgent: null });

    const rosa = { ...utente('rosa', { versione_testi_accettati: '2026-09-01' }), email_confirmed_at: '2026-10-01T10:05:00Z' };
    accessoConPassword.mockResolvedValue({ data: { user: rosa, session: { access_token: 'a', refresh_token: 'r' } }, error: null });
    const res = await accedi(accesso('7.7.7.4') as never);
    guasto.mockRestore();

    expect(esito).toBe('non-scritta');
    expect(res.status, 'l’accesso non si blocca per il verbale').toBe(200);
    expect(profili.get('rosa')!.tos_accepted_at, 'profilo segnato «accettato» senza la riga che lo prova').toBeNull();
  });

  it('se il database non risponde, chi ha la password giusta entra lo stesso dopo il tetto di attesa', async () => {
    // Collaudo del 15/10: il database tace mentre il servizio di accesso risponde.
    // Prima la richiesta restava appesa finché la piattaforma non la chiudeva.
    const anna = { ...utente('anna', { versione_testi_accettati: '2026-09-01' }), email_confirmed_at: '2026-10-01T10:05:00Z' };
    accessoConPassword.mockResolvedValue({ data: { user: anna, session: { access_token: 'a', refresh_token: 'r' } }, error: null });
    const muto = vi.spyOn(adminFinto, 'from').mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }),
    }) as never);
    const partenza = Date.now();
    const esito = await Promise.race([
      accedi(accesso('7.7.7.5') as never),
      new Promise<'appesa'>((r) => setTimeout(() => r('appesa'), TETTO_VERBALE_MS + 2500)),
    ]);
    muto.mockRestore();
    expect(esito, 'l’accesso resta appeso dietro al verbale').not.toBe('appesa');
    expect((esito as Response).status).toBe(200);
    expect(Date.now() - partenza).toBeLessThan(TETTO_VERBALE_MS + 2000);
  }, 15000);
});
