import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 3/9/2026 — UN INTOPPO DI SUPABASE BUTTAVA FUORI CHI ERA GIA' ENTRATO.
 *
 * Il portiere del sito (il middleware) chiede due cose a ogni pagina: «chi
 * sei?» al servizio di accesso e «che ruolo ha?» al database. Quelle due
 * domande buttavano via l'errore per costruzione, quindi «il fornitore non
 * risponde» e «non ha fatto l'accesso» finivano nello stesso ramo: chi stava
 * comprando si ritrovava sulla schermata di accesso. E non c'era nessun tetto
 * di tempo: trenta secondi lenti del fornitore erano trenta secondi di pagina
 * appesa, davanti a ogni click.
 *
 * Qui si prova il comportamento vero, in due strati:
 *  - la decisione da sola (`lib/auth/decisione-portiere.ts`), che e' una
 *    funzione senza rete: si puo' interrogare caso per caso;
 *  - il portiere vero, chiamato con un fornitore muto, per essere sicuri che
 *    quella decisione sia davvero quella che gira. Una regola giusta che
 *    nessuno chiama non ripara niente.
 */

const createServerClient = vi.fn();
type UtenteFinto = { id: string; email_confirmed_at: string | null } | null;
type RispostaUtente = { data: { user: UtenteFinto }; error?: unknown };
const getUser = vi.fn<() => Promise<RispostaUtente>>(async () => ({ data: { user: null } }));
const profiloLetto = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => {
    createServerClient(...args);
    return {
      auth: { getUser },
      from: () => ({ select: () => ({ eq: () => ({ single: profiloLetto }) }) }),
    };
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const {
  TETTO_PORTIERE_MS,
  chiediConTetto,
  comeStaIlFornitore,
  decidiCacheProfilo,
  decidiPortiere,
  erroreDaFornitoreMuto,
} = await import('@/lib/auth/decisione-portiere');
const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

function richiesta(percorso: string, cookie?: Record<string, string>) {
  const req = new NextRequest(new URL(`https://mycity.test${percorso}`));
  for (const [k, v] of Object.entries(cookie ?? {})) req.cookies.set(k, v);
  return req;
}

/** Il fornitore che non risponde mai: la promessa resta li' per sempre. */
function nonRispondeMai<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** Chiama il portiere lasciando scadere il tetto di tempo, senza aspettare davvero. */
async function portiereConFornitoreAppeso(percorso: string, cookie: Record<string, string>) {
  vi.useFakeTimers();
  try {
    const inCorso = middleware(richiesta(percorso, cookie));
    await vi.advanceTimersByTimeAsync(TETTO_PORTIERE_MS + 50);
    return await inCorso;
  } finally {
    vi.useRealTimers();
  }
}

const SESSIONE = { 'sb-esempio-auth-token': 'gettone-di-chi-e-entrato' };
/** Come risponde davvero il servizio di accesso quando la rete e' caduta. */
const RETE_CADUTA = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 };
/** Come risponde quando la sessione e' semplicemente scaduta: non e' un guasto. */
const SESSIONE_FINITA = { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 };

beforeEach(() => {
  createServerClient.mockClear();
  getUser.mockClear();
  profiloLetto.mockClear();
  getUser.mockResolvedValue({ data: { user: null } });
  profiloLetto.mockResolvedValue({ data: { role: 'buyer', is_approved: true } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('la decisione del portiere, presa da sola', () => {
  it('fornitore muto sul catalogo pubblico: si tira dritto come ospite', () => {
    const d = decidiPortiere({ fornitore: 'muto', utenteTrovato: false, areaProtetta: false });
    expect(d.azione, 'un intoppo del fornitore butta fuori chi sfoglia il catalogo').toBe(
      'passa-come-ospite',
    );
    expect(d.scriviCookieRuolo).toBe(false);
    expect(d.registra, 'il guasto passa senza lasciare una riga da nessuna parte').toBeTruthy();
  });

  it('fornitore muto su area protetta: si chiude, e non si mette niente da parte', () => {
    const d = decidiPortiere({ fornitore: 'muto', utenteTrovato: false, areaProtetta: true });
    expect(d.azione).toBe('chiudi-al-login');
    expect(d.scriviCookieRuolo, 'un ruolo indovinato al buio finirebbe in cache').toBe(false);
    expect(d.registra).toBeTruthy();
  });

  it('nessun utente e fornitore che risponde: e un visitatore, non un guasto', () => {
    const protetta = decidiPortiere({ fornitore: 'risponde', utenteTrovato: false, areaProtetta: true });
    expect(protetta.azione).toBe('chiudi-al-login');
    expect(protetta.registra, 'una sessione scaduta non e un allarme: cosi si smette di leggerli').toBe(
      null,
    );

    const pubblica = decidiPortiere({ fornitore: 'risponde', utenteTrovato: false, areaProtetta: false });
    expect(pubblica.azione).toBe('passa-come-ospite');
    expect(pubblica.registra).toBe(null);
  });

  it('persona verificata: si prosegue, e il ruolo si puo mettere da parte', () => {
    const d = decidiPortiere({ fornitore: 'risponde', utenteTrovato: true, areaProtetta: true });
    expect(d.azione).toBe('prosegui');
    expect(d.scriviCookieRuolo).toBe(true);
  });

  it('persona verificata ma risposta storta: si prosegue senza mettere niente in cache', () => {
    const d = decidiPortiere({ fornitore: 'muto', utenteTrovato: true, areaProtetta: false });
    expect(d.azione).toBe('prosegui');
    expect(d.scriviCookieRuolo).toBe(false);
  });
});

describe('«non ha fatto l accesso» e «non ho potuto chiedere» si distinguono', () => {
  it('la sessione scaduta non e un fornitore muto', () => {
    expect(erroreDaFornitoreMuto(SESSIONE_FINITA)).toBe(false);
    expect(erroreDaFornitoreMuto({ status: 401, message: 'invalid claim' })).toBe(false);
    expect(erroreDaFornitoreMuto(null)).toBe(false);
  });

  it('la rete caduta e i cinquecento del fornitore lo sono', () => {
    expect(erroreDaFornitoreMuto(RETE_CADUTA)).toBe(true);
    expect(erroreDaFornitoreMuto({ status: 503, message: 'service unavailable' })).toBe(true);
    expect(erroreDaFornitoreMuto(new Error('fetch failed'))).toBe(true);
  });

  it('una chiamata scaduta o rotta vale come fornitore muto', () => {
    expect(comeStaIlFornitore({ stato: 'scaduto' })).toBe('muto');
    expect(comeStaIlFornitore({ stato: 'rotto', errore: new Error('boom') })).toBe('muto');
    expect(comeStaIlFornitore({ stato: 'ok', valore: { error: null } })).toBe('risponde');
    expect(comeStaIlFornitore({ stato: 'ok', valore: { error: RETE_CADUTA } })).toBe('muto');
  });
});

describe('il tetto di tempo', () => {
  it('smette di aspettare chi non risponde', async () => {
    const esito = await chiediConTetto(() => nonRispondeMai<string>(), 20);
    expect(esito.stato, 'il portiere aspetta ancora per sempre').toBe('scaduto');
  });

  it('una chiamata che scoppia diventa una risposta, non un errore cinquecento', async () => {
    const esito = await chiediConTetto(() => Promise.reject(new Error('rete giu')), 20);
    expect(esito.stato).toBe('rotto');
  });

  it('quando il fornitore risponde in tempo, la risposta passa intera', async () => {
    const esito = await chiediConTetto(async () => ({ error: null, data: 'ok' }), 20);
    expect(esito).toEqual({ stato: 'ok', valore: { error: null, data: 'ok' } });
  });

  it('il profilo scaduto o sbagliato non entra nel cookie da dieci minuti', () => {
    expect(decidiCacheProfilo({ stato: 'scaduto' }).mettiInCache).toBe(false);
    expect(decidiCacheProfilo({ stato: 'rotto', errore: new Error('x') }).mettiInCache).toBe(false);
    expect(decidiCacheProfilo({ stato: 'ok', valore: { error: { message: 'boom' } } }).mettiInCache).toBe(
      false,
    );
    expect(decidiCacheProfilo({ stato: 'ok', valore: { error: null } }).mettiInCache).toBe(true);
  });
});

describe('il portiere vero, con il fornitore muto', () => {
  it('chi sfoglia il catalogo non viene buttato fuori', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: RETE_CADUTA });
    const res = await middleware(richiesta('/product/abc', SESSIONE));
    expect(res.status, 'un intoppo del fornitore ha rimandato altrove chi stava comprando').toBe(200);
    expect(res.headers.get('location')).toBe(null);
  });

  it('sull area protetta si chiude, e il ruolo non finisce nel cookie', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: RETE_CADUTA });
    const res = await middleware(richiesta('/profile', SESSIONE));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/sign-in');
    expect(res.cookies.get('mc_ruolo'), 'un ruolo indovinato al buio e finito in cache').toBeUndefined();
    expect(profiloLetto, 'il profilo e stato letto senza sapere di chi').not.toHaveBeenCalled();
  });

  it('il guasto lascia una riga nei log, la sessione scaduta no', async () => {
    const avvisi = vi.spyOn(console, 'warn').mockImplementation(() => {});

    getUser.mockResolvedValue({ data: { user: null }, error: RETE_CADUTA });
    await middleware(richiesta('/profile', SESSIONE));
    expect(avvisi, 'del guasto non resta traccia: l indagine parte dal nulla').toHaveBeenCalled();

    avvisi.mockClear();
    getUser.mockResolvedValue({ data: { user: null }, error: SESSIONE_FINITA });
    await middleware(richiesta('/profile', SESSIONE));
    expect(avvisi, 'ogni sessione scaduta scrive un avviso: cosi non si leggono piu').not.toHaveBeenCalled();
  });

  /**
   * Il tetto di tempo si mangia anche le chiamate che scoppiano: prima
   * arrivavano a Sentry da sole, come errore del middleware. Se restassero un
   * avviso qualunque le avremmo solo nascoste meglio.
   */
  it('una chiamata che scoppia non fa cadere la pagina, ma arriva dove si guarda', async () => {
    const avvisi = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errori = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUser.mockRejectedValue(new Error('il client e esploso'));

    const res = await middleware(richiesta('/product/abc', SESSIONE));
    expect(res.status, 'un guasto del portiere ha portato giu una pagina del catalogo').toBe(200);
    expect(errori, 'il guasto e finito fra gli avvisi: a Sentry non arriva niente').toHaveBeenCalled();
    expect(avvisi).not.toHaveBeenCalled();
  });

  it('chi non ha davvero fatto l accesso va alla schermata di accesso, come prima', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: SESSIONE_FINITA });
    const res = await middleware(richiesta('/profile', SESSIONE));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/sign-in');
    expect(res.headers.get('location')).toContain('returnTo=%2Fprofile');
  });
});

describe('il portiere non resta appeso alla rete', () => {
  it('il catalogo si apre lo stesso se il servizio di accesso non risponde', async () => {
    getUser.mockImplementation(() => nonRispondeMai<RispostaUtente>());
    const res = await portiereConFornitoreAppeso('/product/abc', SESSIONE);
    expect(res.status, 'la pagina resta appesa finche il fornitore non si decide').toBe(200);
  });

  it('l area protetta si chiude entro il tetto invece di restare appesa', async () => {
    getUser.mockImplementation(() => nonRispondeMai<RispostaUtente>());
    const res = await portiereConFornitoreAppeso('/profile', SESSIONE);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/sign-in');
  });

  it('se il database non risponde, il ruolo sbagliato non resta dieci minuti nel cookie', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u-1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    });
    profiloLetto.mockImplementation(() => nonRispondeMai());

    const res = await portiereConFornitoreAppeso('/product/abc', SESSIONE);
    expect(res.status).toBe(200);
    expect(
      res.cookies.get('mc_ruolo'),
      'un profilo mai arrivato e finito in cache per dieci minuti',
    ).toBeUndefined();
  });
});
