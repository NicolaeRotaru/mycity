import { describe, it, expect, vi, beforeEach } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

type UtenteFinto = { id: string; email_confirmed_at: string } | null;
const getUser = vi.fn<() => Promise<{ data: { user: UtenteFinto }; error?: unknown }>>();
const profiloLetto = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: profiloLetto }) }) }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

/**
 * UN INTOPPO DI SUPABASE DECLASSAVA CHI ERA GIA' ENTRATO — PER DIECI MINUTI.
 *
 * Radiografia del 27/8/2026 (R185). Il middleware legge il profilo per sapere
 * chi sei, e poi mette il risultato in un cookie firmato che dura dieci minuti,
 * per non ripetere la domanda a ogni pagina.
 *
 * L'errore della lettura non veniva guardato. Se il database aveva un intoppo,
 * `profile` arrivava vuoto e il codice ne ricavava «ruolo: nessuno, approvato:
 * no» — e poi **scriveva quella risposta nel cookie**. Cioe' un singolo
 * secondo storto del database trasformava un venditore approvato in uno
 * sconosciuto per i dieci minuti successivi, anche dopo che il database era
 * tornato a posto. Fuori dal suo pannello, senza un messaggio, senza una riga
 * nei registri.
 *
 * La differenza che mancava e' fra «ho chiesto e la risposta e' no» e «non ho
 * potuto chiedere». La seconda non e' una risposta, e non va messa in cache.
 */

const UTENTE: UtenteFinto = { id: 'utente-1', email_confirmed_at: '2026-01-01T00:00:00Z' };

/**
 * Serve il cookie di sessione: senza, il middleware esce prima di costruire il
 * client Supabase (e' la scorciatoia per il traffico anonimo, #086). Qui il
 * caso da provare e' proprio quello di chi la sessione ce l'ha.
 */
function richiesta(percorso: string) {
  const req = new NextRequest(new URL(`https://mycity.test${percorso}`));
  req.cookies.set('sb-esempio-auth-token', 'sessione-finta');
  return req;
}

/** Il cookie del ruolo, se il middleware l'ha scritto in questa risposta. */
function cookieDelRuolo(res: { cookies: { get: (n: string) => { value: string } | undefined } }) {
  return res.cookies.get('mc_ruolo');
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: UTENTE } });
  profiloLetto.mockResolvedValue({ data: { role: 'seller', is_approved: true }, error: null });
});

describe('un intoppo del database non declassa chi e gia entrato', () => {
  it('quando il profilo si legge, il ruolo finisce in cache', async () => {
    const res = await middleware(richiesta('/profile'));
    const cookie = cookieDelRuolo(res);
    expect(cookie, 'il ruolo letto bene deve essere messo in cache').toBeDefined();
    expect(cookie!.value).toContain('seller');
  });

  /**
   * Il cuore del difetto: la lettura FALLISCE, e la risposta sbagliata veniva
   * scritta nel cookie firmato che vale dieci minuti.
   */
  it('quando la lettura del profilo fallisce, NON si scrive niente in cache', async () => {
    profiloLetto.mockResolvedValue({ data: null, error: { message: 'connessione interrotta' } });
    const res = await middleware(richiesta('/profile'));
    expect(
      cookieDelRuolo(res),
      'un intoppo del database e stato messo in cache come «questo utente non ha ruolo»: resta cosi per dieci minuti',
    ).toBeUndefined();
  });

  it('e lo dice, invece di tacere', async () => {
    profiloLetto.mockResolvedValue({ data: null, error: { message: 'connessione interrotta' } });
    await middleware(richiesta('/profile'));
    expect(warn, 'il database non ha risposto e non c e traccia da nessuna parte').toHaveBeenCalled();
  });

  /**
   * L'altra chiamata: se non si e' potuto nemmeno chiedere CHI e', va
   * distinto da «non e' entrato nessuno». Il rimando al login resta — su una
   * pagina protetta e' la scelta prudente — ma non in silenzio.
   */
  it('se non si e potuto chiedere chi e, resta una traccia', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'servizio non raggiungibile' } });
    const res = await middleware(richiesta('/profile'));
    expect(res.status).toBe(307);
    expect(warn, 'Supabase non ha risposto e l utente e stato buttato fuori senza una riga').toHaveBeenCalled();
  });

  it('un utente davvero non autenticato non fa rumore: e la normalita', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(richiesta('/profile'));
    expect(res.status).toBe(307);
    expect(warn, 'un visitatore senza sessione non e un guasto: non deve riempire i registri').not.toHaveBeenCalled();
  });
});
