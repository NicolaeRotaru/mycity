/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';
import { CHIAVE_EMAIL_DA_CONFERMARE } from '@/lib/auth/conferma-email';

/**
 * 15/10/2026 (R43 · R13) — LE REGOLE C'ERANO, MA NESSUNO GUARDAVA SE LE PAGINE LE USAVANO.
 *
 * La prima consegna provava le funzioni che decidono (`vistaDellaVerifica`,
 * `avvisoAlRitornoSullAccesso`, `motivoLinkPasswordSenzaSessione`…) e la rotta
 * di accesso. Le pagine no: il collaudo ha rimesso nella pagina di verifica la
 * riga del difetto (`disabled={resending || !emailDellaSessione}`), ha tolto il
 * ricordo dell'email dalla registrazione, ha fatto dire «password sbagliata» alla
 * pagina di accesso — e la suite restava verde. Nel browser, intanto, Maria
 * tornava a vedere «Reinvia» grigio.
 *
 * Qui le pagine VERE vengono montate, con i loro stati e i loro effetti, e si
 * guarda quello che vede la persona: il campo, il pulsante acceso o spento, la
 * frase, dove la porta la pagina. Il percorso di Maria dall'inizio alla fine:
 *  ① si iscrive dal checkout → la registrazione lascia la sua email e la porta
 *    a «Verifica la tua email»;
 *  ② «Verifica la tua email» le mostra la sua email e «Reinvia» è acceso; il
 *    clic rimanda davvero il link a lei, verso il checkout;
 *  ③ chi arriva sulla verifica senza niente trova un campo, e «Reinvia» si
 *    accende appena l'email è scritta; «Esci» solo a chi è entrato;
 *  ④ il giorno dopo prova ad accedere con la password giusta → la pagina di
 *    accesso la porta alla verifica con l'email già pronta, invece di dirle
 *    «password sbagliata»;
 *  ⑤ i due avvisi di R13: la pagina di accesso dice «email confermata, ora
 *    accedi» e /reset-password con un `?code=` spiega perché non va.
 */

type Pagina = ComponentType<Record<string, unknown>>;
type Navigazione = { tipo: string; dove: string };
type G = Record<string, unknown> & {
  __QUERY_FINTA__?: string;
  __UTENTE__?: unknown;
  __AUTH_FINTA__?: Record<string, (...a: unknown[]) => unknown>;
  __NAVIGAZIONI__?: Navigazione[];
};
const g = globalThis as unknown as G;

let Verifica: Pagina;
let Registrazione: Pagina;
let Accesso: Pagina;
let NuovaPassword: Pagina;

beforeAll(async () => {
  const [v, r, a, n] = await Promise.all([
    monta('app/auth/verify-email/page.tsx'),
    monta('app/sign-up/page.tsx'),
    monta('app/sign-in/page.tsx'),
    monta('app/reset-password/page.tsx'),
  ]);
  Verifica = v.default as Pagina;
  Registrazione = r.default as Pagina;
  Accesso = a.default as Pagina;
  NuovaPassword = n.default as Pagina;
}, 120000);

const montate: Array<{ smonta: () => void }> = [];

/** Monta una pagina come se l'indirizzo fosse `percorso`. */
function apri(Pagina: Pagina, percorso: string) {
  const [path, query = ''] = percorso.split('?');
  window.history.replaceState(null, '', percorso);
  g.__QUERY_FINTA__ = query;
  (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = path;
  const s = accendi(Pagina);
  montate.push(s);
  return s;
}

/** Lascia girare effetti e promesse finche' `vero()` non risponde si', o finisce il tempo. */
async function aspettaChe(vero: () => boolean, ms = 3000): Promise<void> {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (vero()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

/** Scrive in un campo come fa una persona: React se ne accorge. */
function scrivi(campo: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  void act(() => {
    setter.call(campo, valore);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

function invia(modulo: HTMLFormElement) {
  void act(() => {
    modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
}

function pulsante(radice: HTMLElement, testo: RegExp): HTMLButtonElement | null {
  return (
    [...radice.querySelectorAll('button')].find((b) => testo.test(testoVisibile(b))) ?? null
  ) as HTMLButtonElement | null;
}

beforeEach(() => {
  window.sessionStorage.clear();
  g.__NAVIGAZIONI__ = [];
  g.__AUTH_FINTA__ = {};
  delete g.__UTENTE__;
});

afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__QUERY_FINTA__;
  delete g.__NAVIGAZIONI__;
  delete g.__AUTH_FINTA__;
  delete g.__UTENTE__;
  vi.unstubAllGlobals();
});

describe('① Maria si iscrive dal checkout', () => {
  it('IL CASO CHE ROMPEVA — la registrazione lascia la sua email e la porta alla verifica, verso il checkout', async () => {
    const iscrizioni: unknown[] = [];
    g.__AUTH_FINTA__ = {
      // Con la conferma dell'email accesa, Supabase crea l'utente ma NON apre la sessione.
      signUp: (dati) => {
        iscrizioni.push(dati);
        return { data: { user: { id: 'maria', email: 'maria.rossi@esempio.it' }, session: null }, error: null };
      },
    };
    const s = apri(Registrazione, '/sign-up?returnTo=/checkout');
    await aspettaChe(() => !!s.radice.querySelector('#signup-email'));

    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-email')!, 'maria.rossi@esempio.it');
    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-password')!, 'una-password-lunga');
    s.agisci(() => s.radice.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    invia(s.radice.querySelector('form')!);
    await aspettaChe(() => (g.__NAVIGAZIONI__ ?? []).length > 0);

    expect(iscrizioni, 'il modulo non ha nemmeno chiamato la registrazione: la prova non sta guardando niente').toHaveLength(1);
    expect(
      window.sessionStorage.getItem(CHIAVE_EMAIL_DA_CONFERMARE),
      'la registrazione non lascia l’email: la pagina di verifica non sa a chi rimandare il link e «Reinvia» resta grigio',
    ).toBe('maria.rossi@esempio.it');
    expect(g.__NAVIGAZIONI__).toContainEqual({ tipo: 'push', dove: '/auth/verify-email?returnTo=%2Fcheckout' });
  }, 30000);
});

describe('② «Verifica la tua email» con l’email lasciata dalla registrazione', () => {
  it('IL CASO CHE ROMPEVA — mostra la sua email e «Reinvia» è acceso, senza nessuna sessione', async () => {
    window.sessionStorage.setItem(CHIAVE_EMAIL_DA_CONFERMARE, 'maria.rossi@esempio.it');
    const s = apri(Verifica, '/auth/verify-email?returnTo=/checkout');
    await aspettaChe(() => testoVisibile(s.radice).includes('maria.rossi@esempio.it'));

    expect(testoVisibile(s.radice)).toContain('Ti abbiamo inviato un link di conferma a maria.rossi@esempio.it');
    const reinvia = pulsante(s.radice, /Reinvia/);
    expect(reinvia, 'il pulsante «Reinvia» non c’è').not.toBeNull();
    expect(reinvia!.disabled, '«Reinvia» è grigio: è il difetto R43, Maria resta chiusa fuori').toBe(false);
    expect(pulsante(s.radice, /^Esci$/), '«Esci» a una persona che non è mai entrata').toBeNull();
  }, 30000);

  it('il clic rimanda davvero il link a lei, e il link nuovo torna al checkout', async () => {
    const rinvii: Array<{ type: string; email: string; options?: { emailRedirectTo?: string } }> = [];
    g.__AUTH_FINTA__ = {
      resend: (dati) => {
        rinvii.push(dati as (typeof rinvii)[number]);
        return { data: {}, error: null };
      },
    };
    window.sessionStorage.setItem(CHIAVE_EMAIL_DA_CONFERMARE, 'maria.rossi@esempio.it');
    const s = apri(Verifica, '/auth/verify-email?returnTo=/checkout');
    await aspettaChe(() => pulsante(s.radice, /Reinvia/)?.disabled === false);

    s.agisci(() => clicca(pulsante(s.radice, /Reinvia/)!));
    await aspettaChe(() => !!s.radice.querySelector('[role="status"]'));

    expect(rinvii, 'il clic su «Reinvia» non ha rimandato niente').toHaveLength(1);
    expect(rinvii[0].type).toBe('signup');
    expect(rinvii[0].email).toBe('maria.rossi@esempio.it');
    const ritorno = new URL(rinvii[0].options!.emailRedirectTo!);
    expect(ritorno.pathname).toBe('/auth/callback');
    expect(ritorno.searchParams.get('next')).toMatch(/^\/checkout/);
    expect(testoVisibile(s.radice.querySelector('[role="status"]'))).toMatch(/nuovo link sta arrivando/);
  }, 30000);
});

describe('③ chi arriva sulla verifica senza niente in mano', () => {
  it('IL CASO CHE ROMPEVA — trova un campo, e «Reinvia» si accende appena scrive l’email', async () => {
    const s = apri(Verifica, '/auth/verify-email');
    await aspettaChe(() => !!s.radice.querySelector('#verify-email-input'));

    const campo = s.radice.querySelector<HTMLInputElement>('#verify-email-input');
    expect(campo, 'senza sessione e senza email ricordata non c’è nessun modo di dire a chi rimandare il link').not.toBeNull();
    expect(pulsante(s.radice, /Reinvia/)!.disabled, 'col campo vuoto il pulsante non deve partire').toBe(true);

    scrivi(campo!, 'maria.rossi@esempio.it');
    await aspettaChe(() => pulsante(s.radice, /Reinvia/)?.disabled === false);
    expect(pulsante(s.radice, /Reinvia/)!.disabled, 'scritta l’email, «Reinvia» resta grigio').toBe(false);
    expect(pulsante(s.radice, /^Esci$/), '«Esci» a una persona che non è mai entrata').toBeNull();
    expect(s.radice.querySelector('a[href="/sign-in"]'), 'chi ha già confermato deve trovare la strada per accedere').not.toBeNull();
  }, 30000);

  it('chi è entrato ma non ha confermato vede la sua email, «Reinvia» acceso e «Esci»', async () => {
    g.__UTENTE__ = { id: 'pino', email: 'pino@esempio.it', email_confirmed_at: null };
    const s = apri(Verifica, '/auth/verify-email');
    await aspettaChe(() => testoVisibile(s.radice).includes('pino@esempio.it'));

    expect(s.radice.querySelector('#verify-email-input'), 'a chi è entrato l’email non va richiesta').toBeNull();
    expect(pulsante(s.radice, /Reinvia/)!.disabled).toBe(false);
    expect(pulsante(s.radice, /^Esci$/), 'chi è entrato deve poter uscire').not.toBeNull();
  }, 30000);
});

describe('④ il giorno dopo Maria prova ad accedere con la password giusta', () => {
  function rispondeLaRotta(stato: number, corpo: unknown) {
    const chiamate: unknown[] = [];
    vi.stubGlobal('fetch', async (dove: unknown, opzioni?: { body?: string }) => {
      chiamate.push({ dove: String(dove), corpo: JSON.parse(opzioni?.body ?? '{}') });
      return { ok: stato >= 200 && stato < 300, status: stato, json: async () => corpo };
    });
    return chiamate;
  }

  async function accedeCome(email: string, percorso = '/sign-in?returnTo=/checkout') {
    const s = apri(Accesso, percorso);
    await aspettaChe(() => !!s.radice.querySelector('#signin-email'));
    scrivi(s.radice.querySelector<HTMLInputElement>('#signin-email')!, email);
    scrivi(s.radice.querySelector<HTMLInputElement>('#signin-password')!, 'una-password-lunga');
    invia(s.radice.querySelector('form')!);
    return s;
  }

  it('IL CASO CHE ROMPEVA — la rotta dice «email da confermare»: la pagina la porta alla verifica con l’email pronta', async () => {
    const chiamate = rispondeLaRotta(403, {
      ok: false,
      error: { code: 'EMAIL_NOT_VERIFIED', message: 'Devi confermare la tua email prima di accedere. Controlla la posta.' },
    });
    await accedeCome('maria.rossi@esempio.it');
    await aspettaChe(() => (g.__NAVIGAZIONI__ ?? []).length > 0);

    expect(chiamate, 'il modulo non ha chiamato la rotta di accesso').toHaveLength(1);
    expect(
      g.__NAVIGAZIONI__,
      'la pagina non porta alla verifica: Maria legge un errore e resta fuori',
    ).toContainEqual({ tipo: 'push', dove: '/auth/verify-email?returnTo=%2Fcheckout' });
    expect(window.sessionStorage.getItem(CHIAVE_EMAIL_DA_CONFERMARE), 'arriva alla verifica senza la sua email').toBe(
      'maria.rossi@esempio.it',
    );
  }, 30000);

  it('anche quando la rotta la fa entrare ma l’email risulta non confermata, la porta alla verifica', async () => {
    rispondeLaRotta(200, { user: { id: 'maria', email_confirmed_at: null }, session: null });
    await accedeCome('maria.rossi@esempio.it');
    await aspettaChe(() => (g.__NAVIGAZIONI__ ?? []).length > 0);
    expect(g.__NAVIGAZIONI__).toContainEqual({ tipo: 'push', dove: '/auth/verify-email?returnTo=%2Fcheckout' });
    expect(window.sessionStorage.getItem(CHIAVE_EMAIL_DA_CONFERMARE)).toBe('maria.rossi@esempio.it');
  }, 30000);

  it('con la password sbagliata non la manda alla verifica e non ricorda niente', async () => {
    rispondeLaRotta(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Email o password non corretti' } });
    const s = await accedeCome('maria.rossi@esempio.it');
    // Il modulo ha finito quando il pulsante torna premibile.
    await aspettaChe(() => !!pulsante(s.radice, /^Accedi$/));
    await aspettaChe(() => false, 100);
    expect(g.__NAVIGAZIONI__).toEqual([]);
    expect(window.sessionStorage.getItem(CHIAVE_EMAIL_DA_CONFERMARE)).toBeNull();
  }, 30000);
});

describe('⑤ i due avvisi di R13 sulle pagine vere', () => {
  it('IL CASO CHE ROMPEVA — chi ha confermato da un altro dispositivo legge «la tua email è confermata, ora accedi»', async () => {
    const s = apri(Accesso, '/sign-in?error=email_confermata&returnTo=/checkout');
    await aspettaChe(() => !!s.radice.querySelector('[role="status"]'));
    const avviso = s.radice.querySelector('[role="status"]');
    expect(avviso, 'la pagina di accesso tace: la persona non sa che deve solo accedere').not.toBeNull();
    expect(testoVisibile(avviso)).toMatch(/La tua email è confermata\. Ora accedi/);
  }, 30000);

  it('il link scaduto lo dice come errore, e senza errore nell’indirizzo la pagina non dice niente', async () => {
    const s = apri(Accesso, '/sign-in?error=link_scaduto');
    await aspettaChe(() => !!s.radice.querySelector('[role="alert"]'));
    expect(testoVisibile(s.radice.querySelector('[role="alert"]'))).toMatch(/scaduto/);
    s.smonta();
    montate.length = 0;

    const pulita = apri(Accesso, '/sign-in');
    await aspettaChe(() => !!pulita.radice.querySelector('#signin-email'));
    await aspettaChe(() => false, 100);
    expect(pulita.radice.querySelector('[role="status"], [role="alert"]')).toBeNull();
  }, 30000);

  it('la sessione lasciata nel frammento viene tolta dalla barra degli indirizzi', async () => {
    const s = apri(Accesso, '/sign-in?error=missing_code');
    window.history.replaceState(null, '', '/sign-in?error=missing_code#access_token=segreto&refresh_token=r&type=signup');
    s.smonta();
    montate.length = 0;
    const r = accendi(Accesso);
    montate.push(r);
    await aspettaChe(() => !!r.radice.querySelector('[role="status"]'));
    expect(testoVisibile(r.radice.querySelector('[role="status"]'))).toMatch(/email è confermata/);
    expect(window.location.hash, 'il gettone resta nella barra e nella cronologia').toBe('');
  }, 30000);

  it('IL CASO CHE ROMPEVA — /reset-password con un `?code=` e senza sessione spiega di aprirlo dove l’ha chiesto', async () => {
    const s = apri(NuovaPassword, '/reset-password?code=1b2c3d4e');
    // La pagina aspetta 800 millisecondi la sessione prima di decidere.
    await aspettaChe(() => !!s.radice.querySelector('[role="alert"]'), 4000);
    const spiegazione = s.radice.querySelector('[role="alert"]');
    expect(spiegazione, 'la pagina ripiega in silenzio su «Inserisci la tua email», come prima').not.toBeNull();
    expect(testoVisibile(spiegazione)).toMatch(/Questo link va aperto dove l’hai chiesto/);
    expect(s.radice.querySelector('#reset-request-email'), 'e sotto c’è il modulo per chiederne uno nuovo').not.toBeNull();
  }, 30000);

  it('/reset-password?errore=link_scaduto dice che il link è scaduto', async () => {
    const s = apri(NuovaPassword, '/reset-password?errore=link_scaduto');
    await aspettaChe(() => !!s.radice.querySelector('[role="alert"]'), 4000);
    expect(testoVisibile(s.radice.querySelector('[role="alert"]'))).toMatch(/Il link è scaduto/);
  }, 30000);

  it('chi viene solo a chiedere il link non riceve spiegazioni inutili', async () => {
    const s = apri(NuovaPassword, '/reset-password');
    await aspettaChe(() => !!s.radice.querySelector('#reset-request-email'), 4000);
    expect(s.radice.querySelector('[role="alert"]')).toBeNull();
  }, 30000);
});
