import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

import {
  TETTO_PORTIERE_MS,
  decidiPortiere,
} from '@/lib/auth/decisione-portiere';
import {
  chiediConTettoSuScritturaDiSessione,
  creaRaccoglitoreCookie,
  eCookieDiSessione,
  travasaCookie,
  type CookieRaccolto,
} from '@/lib/auth/cookie-di-sessione';

/**
 * 8/9/2026 — LA DISCONNESSIONE SILENZIOSA A META' DELLA SPESA.
 *
 * Chi è dentro il sito tiene due tessere nel browser: una che scade in fretta,
 * e una che serve a farsene dare un'altra. A ogni pagina il portiere chiede al
 * servizio di accesso «chi sei?». Se la prima è scaduta, quella domanda NON è
 * solo una domanda: il servizio stampa una coppia nuova e brucia la vecchia.
 *
 * La coppia nuova torna indietro per una via sola — la callback `set()`, che
 * scrive i cookie sulla risposta. Ma il portiere, tutte le volte che rimanda
 * altrove, costruisce una risposta NUOVA e vuota: i cookie appena stampati
 * restavano su quella scartata. E quando il tetto di tempo di tre secondi
 * scattava, la risposta partiva prima che la callback avesse scritto.
 *
 * In tutti e due i casi il browser resta con una tessera che il server ha già
 * bruciato: al click dopo la persona è fuori, con il carrello a metà, senza
 * aver fatto niente di sbagliato.
 *
 * Qui si prova il comportamento, non le parole: si fa arrivare il rinnovo in
 * tempo e in ritardo, e si guarda se finisce davvero addosso alla risposta.
 *
 * ⚠️ QUELLO CHE QUESTA PROVA NON COPRE, DETTO CHIARO: il portiere vero
 * (`middleware.ts`) non è di questa corsia e ancora NON chiama queste
 * funzioni. Qui si prova il pezzo che mancava, non la cura montata sul motore.
 */

/** Il nome vero di un cookie di sessione Supabase su questo progetto. */
const COOKIE_SESSIONE = 'sb-esempio-auth-token';

afterEach(() => {
  vi.useRealTimers();
});

/** Come `@supabase/ssr` scrive un cookie di sessione: valore + opzioni. */
const OPZIONI = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: true };

describe('il rinnovo della sessione sale sulla risposta che esce davvero', () => {
  it('i cookie nuovi finiscono anche su un rimando costruito dopo', () => {
    const raccoglitore = creaRaccoglitoreCookie();
    // È il servizio di accesso che parla: ha rinnovato, ecco la tessera nuova.
    raccoglitore.set(COOKIE_SESSIONE, 'gettone-nuovo', OPZIONI);

    // Il portiere rimanda alla schermata di accesso: risposta nuova di zecca.
    const rimando = NextResponse.redirect(new URL('https://mycity.test/sign-in'));
    const versati = travasaCookie(raccoglitore.daConsegnare(), rimando);

    expect(versati).toBe(1);
    expect(
      rimando.cookies.get(COOKIE_SESSIONE)?.value,
      'il rimando parte senza la tessera nuova: il browser resta con quella bruciata',
    ).toBe('gettone-nuovo');
    expect(rimando.cookies.get(COOKIE_SESSIONE)?.httpOnly).toBe(true);
  });

  /**
   * SCELTA SEVERA (a). Perdere una cancellazione è la più permissiva delle
   * dimenticanze: il server ha deciso di spegnere quella sessione, e il
   * browser continua a tenersela in tasca come se niente fosse.
   */
  it('anche una cancellazione decisa dal server arriva al browser', () => {
    const raccoglitore = creaRaccoglitoreCookie();
    raccoglitore.remove(COOKIE_SESSIONE, { path: '/' });

    const rimando = NextResponse.redirect(new URL('https://mycity.test/'));
    travasaCookie(raccoglitore.daConsegnare(), rimando);

    const cancellato = rimando.cookies.get(COOKIE_SESSIONE);
    expect(
      cancellato,
      'la cancellazione si è persa: il browser tiene una sessione che il server ha spento',
    ).toBeDefined();
    expect(cancellato?.value).toBe('');
  });

  /** SCELTA SEVERA (b): sui cookie di sessione l'ultima parola è di chi accede. */
  it('sul cookie di sessione vince quello nuovo, non quello che era già lì', () => {
    const raccoglitore = creaRaccoglitoreCookie();
    raccoglitore.set(COOKIE_SESSIONE, 'gettone-nuovo', OPZIONI);

    const rimando = NextResponse.redirect(new URL('https://mycity.test/'));
    rimando.cookies.set({ name: COOKIE_SESSIONE, value: 'gettone-vecchio', path: '/' });
    travasaCookie(raccoglitore.daConsegnare(), rimando);

    expect(rimando.cookies.get(COOKIE_SESSIONE)?.value).toBe('gettone-nuovo');
  });

  it('i cookie che non sono di sessione passano lo stesso, senza scelte furbe', () => {
    const raccoglitore = creaRaccoglitoreCookie();
    raccoglitore.set('sb-esempio-auth-token.0', 'pezzo-uno', OPZIONI);
    raccoglitore.set('sb-esempio-auth-token.1', 'pezzo-due', OPZIONI);

    const risposta = NextResponse.next();
    expect(travasaCookie(raccoglitore.daConsegnare(), risposta)).toBe(2);
    expect(risposta.cookies.get('sb-esempio-auth-token.0')?.value).toBe('pezzo-uno');
    expect(risposta.cookies.get('sb-esempio-auth-token.1')?.value).toBe('pezzo-due');
  });
});

describe('il tetto di tempo su una chiamata che tocca la sessione', () => {
  /**
   * Il finto servizio di accesso: dopo `ritardo` millisecondi scrive la
   * tessera nuova nei cookie (è quello che fa `@supabase/ssr` quando la
   * libreria rinnova) e poi risponde chi è la persona.
   */
  function servizioCheRinnovaDopo(ritardo: number, raccoglitore: ReturnType<typeof creaRaccoglitoreCookie>) {
    return () =>
      new Promise<{ data: { user: { id: string } }; error: null }>((risolvi) => {
        setTimeout(() => {
          raccoglitore.set(COOKIE_SESSIONE, 'gettone-nuovo', OPZIONI);
          risolvi({ data: { user: { id: 'u-1' } }, error: null });
        }, ritardo);
      });
  }

  it('se risponde in tempo, il rinnovo parte insieme al rimando', async () => {
    vi.useFakeTimers();
    const raccoglitore = creaRaccoglitoreCookie();

    const inCorso = chiediConTettoSuScritturaDiSessione(
      servizioCheRinnovaDopo(1000, raccoglitore),
      raccoglitore,
      TETTO_PORTIERE_MS,
    );
    await vi.advanceTimersByTimeAsync(1100);
    const esito = await inCorso;

    expect(esito.risposta.stato).toBe('ok');
    expect(esito.consegna.stato).toBe('consegnata');
    expect(esito.consegna.sessioneAffidabile).toBe(true);

    // La prova che chiedeva la scheda: la risposta di rimando porta i cookie
    // aggiornati. Prima era un `NextResponse.redirect` nudo.
    const rimando = NextResponse.redirect(new URL('https://mycity.test/auth/verify-email'));
    travasaCookie(esito.daConsegnare, rimando);
    expect(
      rimando.cookies.get(COOKIE_SESSIONE)?.value,
      'il rimando è partito senza la sessione rinnovata',
    ).toBe('gettone-nuovo');
  });

  it('se ci mette più del tetto, il rinnovo si perde — e adesso si vede', async () => {
    vi.useFakeTimers();
    const raccoglitore = creaRaccoglitoreCookie();
    const tardivi: CookieRaccolto[] = [];
    raccoglitore.alTardivo((c) => tardivi.push(c));

    const inCorso = chiediConTettoSuScritturaDiSessione(
      servizioCheRinnovaDopo(3500, raccoglitore),
      raccoglitore,
      TETTO_PORTIERE_MS,
    );
    await vi.advanceTimersByTimeAsync(TETTO_PORTIERE_MS + 50);
    const esito = await inCorso;

    expect(esito.risposta.stato).toBe('scaduto');
    expect(esito.daConsegnare, 'non c è ancora niente da consegnare').toHaveLength(0);
    // SCELTA SEVERA (c): scaduto non vale mai «andata bene».
    expect(esito.consegna.stato).toBe('forse-persa');
    expect(esito.consegna.sessioneAffidabile).toBe(false);
    expect(esito.consegna.registra).toBeTruthy();

    // Il rinnovo arriva adesso, a risposta già decisa.
    await vi.advanceTimersByTimeAsync(600);

    // SCELTA SEVERA (d): non si consegna (non si può) e non si nasconde.
    expect(
      tardivi,
      'il rinnovo arrivato tardi passa senza lasciare traccia: la frequenza resta invisibile',
    ).toHaveLength(1);
    expect(tardivi[0]?.name).toBe(COOKIE_SESSIONE);
    expect(tardivi[0]?.tardivo).toBe(true);
    expect(raccoglitore.haToccatoLaSessione()).toBe(true);
    expect(raccoglitore.sigillato()).toBe(true);

    // E soprattutto: non finisce addosso a una risposta già partita.
    const rimando = NextResponse.redirect(new URL('https://mycity.test/sign-in'));
    travasaCookie(raccoglitore.daConsegnare(), rimando);
    expect(rimando.cookies.get(COOKIE_SESSIONE)).toBeUndefined();
  });

  it('una scrittura a scatola chiusa non si intrufola fra quelle da consegnare', () => {
    const raccoglitore = creaRaccoglitoreCookie();
    raccoglitore.set(COOKIE_SESSIONE, 'primo', OPZIONI);
    raccoglitore.sigilla();
    raccoglitore.set(COOKIE_SESSIONE, 'secondo', OPZIONI);

    expect(raccoglitore.daConsegnare()).toHaveLength(1);
    expect(raccoglitore.daConsegnare()[0]?.value).toBe('primo');
    expect(raccoglitore.perse()).toHaveLength(1);
    expect(raccoglitore.perse()[0]?.value).toBe('secondo');
  });
});

/**
 * IL GUARDIANO DELLA PARTE SEVERA.
 *
 * Il rimedio a questo difetto è far arrivare i cookie: la tentazione, la
 * prossima volta che qualcuno guarda questo codice, è invece «visto che non
 * sappiamo, lasciamolo passare». Qui si blocca quella strada: un tetto
 * scattato resta un motivo per chiudere, non per aprire.
 */
describe('un tetto scattato non diventa mai un lasciapassare', () => {
  it('sull area protetta si chiude, e nessun ruolo va in cache', () => {
    const d = decidiPortiere({ fornitore: 'muto', utenteTrovato: false, areaProtetta: true });
    expect(d.azione).toBe('chiudi-al-login');
    expect(d.scriviCookieRuolo).toBe(false);
  });

  it('sul catalogo si passa da ospite: si guarda, non si è nessuno', () => {
    const d = decidiPortiere({ fornitore: 'muto', utenteTrovato: false, areaProtetta: false });
    expect(d.azione).toBe('passa-come-ospite');
    expect(d.scriviCookieRuolo).toBe(false);
  });
});

describe('quale cookie è una sessione, scritto in un posto solo', () => {
  it('riconosce il cookie intero e i suoi pezzi', () => {
    expect(eCookieDiSessione('sb-esempio-auth-token')).toBe(true);
    expect(eCookieDiSessione('sb-esempio-auth-token.0')).toBe(true);
    expect(eCookieDiSessione('sb-esempio-auth-token.1')).toBe(true);
  });

  it('non scambia per sessione i cookie nostri', () => {
    expect(eCookieDiSessione('mc_ruolo')).toBe(false);
    expect(eCookieDiSessione('NEXT_LOCALE')).toBe(false);
    expect(eCookieDiSessione('mc_shop')).toBe(false);
  });
});
