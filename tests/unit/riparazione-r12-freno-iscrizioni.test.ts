/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { VERSIONE_TESTI_LEGALI } from '@/lib/legal/versione';

/**
 * R12-012 (27/11/2026) — LA REGISTRAZIONE NON AVEVA NESSUN FRENO PER RETE.
 *
 * La pagina chiamava `supabase.auth.signUp` dal browser e basta: dalla stessa rete si
 * potevano creare account a raffica, ognuno con la sua email di conferma partita dal
 * nostro dominio. Il freno (5 iscrizioni all'ora per indirizzo) stava solo in una rotta
 * che nessuna pagina chiama.
 *
 * Qui si monta la pagina VERA e si iscrivono persone diverse dalla stessa rete, come
 * farebbe chi le crea a raffica. Le intestazioni della richiesta (da cui il server legge
 * l'indirizzo) sono finte, il freno è quello vero (in memoria: Upstash qui non c'è).
 *  ① sotto la soglia l'iscrizione è quella di prima: stessi dati a Supabase, stessa strada;
 *  ② la sesta dalla stessa rete è rifiutata, e Supabase non viene nemmeno chiamato;
 *  ③ un'altra rete non paga per la prima.
 */

const rete = vi.hoisted(() => ({ ip: '198.51.100.1' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': rete.ip }),
}));

const avvisi = vi.hoisted(() => ({ errori: [] as string[] }));
vi.mock('sonner', async (originale) => {
  const vero = await originale<typeof import('sonner')>();
  const toast = Object.assign((...a: Parameters<typeof vero.toast>) => vero.toast(...a), vero.toast, {
    error: (m: unknown) => {
      avvisi.errori.push(String(m));
      return 0;
    },
    success: () => 0,
  });
  return { ...vero, toast };
});

type Pagina = ComponentType<Record<string, unknown>>;
type Navigazione = { tipo: string; dove: string };
type G = Record<string, unknown> & {
  __QUERY_FINTA__?: string;
  __AUTH_FINTA__?: Record<string, (...a: unknown[]) => unknown>;
  __NAVIGAZIONI__?: Navigazione[];
};
const g = globalThis as unknown as G;

type Iscrizione = {
  email: string;
  password: string;
  options: { data: Record<string, unknown>; emailRedirectTo: string; captchaToken?: string };
};

let Registrazione: Pagina;
beforeAll(async () => {
  Registrazione = (await monta('app/sign-up/page.tsx')).default as Pagina;
}, 120000);

const montate: Array<{ smonta: () => void }> = [];
let iscrizioni: Iscrizione[] = [];
// Ogni prova parte da una rete sua: il freno vero tiene il conto per tutto il file.
let numeroRete = 0;

beforeEach(() => {
  numeroRete += 1;
  rete.ip = `198.51.100.${numeroRete}`;
  iscrizioni = [];
  avvisi.errori = [];
  window.sessionStorage.clear();
  g.__NAVIGAZIONI__ = [];
  g.__AUTH_FINTA__ = {
    // Con la conferma dell'email accesa Supabase crea l'utente e non apre la sessione.
    signUp: (dati) => {
      iscrizioni.push(dati as Iscrizione);
      return { data: { user: { id: `u-${iscrizioni.length}` }, session: null }, error: null };
    },
  };
});

afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__QUERY_FINTA__;
  delete g.__NAVIGAZIONI__;
  delete g.__AUTH_FINTA__;
});

async function aspettaChe(vero: () => boolean, ms = 3000): Promise<void> {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (vero()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

function scrivi(campo: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  void act(() => {
    setter.call(campo, valore);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

function apri(percorso: string) {
  const [path, query = ''] = percorso.split('?');
  window.history.replaceState(null, '', percorso);
  g.__QUERY_FINTA__ = query;
  (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = path;
  const s = accendi(Registrazione);
  montate.push(s);
  return s;
}

/**
 * Una persona compila il modulo e preme «Registrati». Torna quando la pagina ha finito:
 * o l'ha portata alla verifica dell'email, o le ha detto di no.
 */
async function iscrivi(s: ReturnType<typeof apri>, n: number): Promise<void> {
  const navigazioniPrima = g.__NAVIGAZIONI__!.length;
  const erroriPrima = avvisi.errori.length;
  scrivi(s.radice.querySelector<HTMLInputElement>('#signup-name')!, `Persona ${n}`);
  scrivi(s.radice.querySelector<HTMLInputElement>('#signup-email')!, `persona${n}@esempio.it`);
  scrivi(s.radice.querySelector<HTMLInputElement>('#signup-password')!, 'una-password-lunga');
  const consenso = s.radice.querySelector<HTMLInputElement>('#signup-consenso')!;
  if (!consenso.checked) s.agisci(() => consenso.click());
  void act(() => {
    s.radice.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  await aspettaChe(() => g.__NAVIGAZIONI__!.length > navigazioniPrima || avvisi.errori.length > erroriPrima);
  // Il pulsante torna premibile: la pagina ha chiuso il giro.
  await aspettaChe(() => !/in corso/.test(testoVisibile(s.radice.querySelector('button[type="submit"]'))));
}

describe('R12-012 · il freno sulle iscrizioni passa dal server', () => {
  it('① sotto la soglia l’iscrizione è quella di prima: stessi dati a Supabase e la verifica dell’email', async () => {
    const s = apri('/sign-up?returnTo=/checkout');
    await aspettaChe(() => !!s.radice.querySelector('#signup-email'));

    await iscrivi(s, 1);

    expect(iscrizioni, 'sotto la soglia la pagina non ha creato l’account').toHaveLength(1);
    const [prima] = iscrizioni;
    expect(prima.email).toBe('persona1@esempio.it');
    expect(prima.password).toBe('una-password-lunga');
    expect(prima.options.data).toEqual({
      role: 'buyer',
      full_name: 'Persona 1',
      versione_testi_accettati: VERSIONE_TESTI_LEGALI,
    });
    expect(new URL(prima.options.emailRedirectTo).pathname.startsWith('/auth/callback')).toBe(true);
    expect(g.__NAVIGAZIONI__).toEqual([{ tipo: 'push', dove: '/auth/verify-email?returnTo=%2Fcheckout&da=registrazione' }]);
    expect(avvisi.errori, 'sotto la soglia nessun rifiuto').toEqual([]);
    expect(s.radice.querySelector('[role="alert"]')).toBeNull();
  }, 30000);

  it('IL CASO DELLA VOCE — dalla stessa rete la sesta iscrizione dell’ora è rifiutata e Supabase non viene chiamato', async () => {
    const s = apri('/sign-up');
    await aspettaChe(() => !!s.radice.querySelector('#signup-email'));

    for (let n = 1; n <= 5; n++) await iscrivi(s, n);
    expect(iscrizioni.map((i) => i.email), 'le prime cinque devono passare tutte').toEqual([
      'persona1@esempio.it',
      'persona2@esempio.it',
      'persona3@esempio.it',
      'persona4@esempio.it',
      'persona5@esempio.it',
    ]);
    expect(g.__NAVIGAZIONI__).toHaveLength(5);

    await iscrivi(s, 6);
    expect(
      iscrizioni,
      'la sesta iscrizione dell’ora dalla stessa rete è arrivata a Supabase: nessun freno sulle iscrizioni',
    ).toHaveLength(5);
    expect(g.__NAVIGAZIONI__, 'rifiutata, la persona non va alla verifica dell’email').toHaveLength(5);
    const riquadro = testoVisibile(s.radice.querySelector('[role="alert"]'));
    expect(riquadro).toMatch(/Troppe registrazioni/);
    expect(avvisi.errori.at(-1)).toMatch(/Troppe registrazioni/);
  }, 60000);

  it('③ un’altra rete non paga per la prima', async () => {
    const s = apri('/sign-up');
    await aspettaChe(() => !!s.radice.querySelector('#signup-email'));
    for (let n = 1; n <= 6; n++) await iscrivi(s, n);
    expect(iscrizioni).toHaveLength(5);

    rete.ip = '203.0.113.77';
    await iscrivi(s, 7);
    expect(iscrizioni.map((i) => i.email).at(-1), 'da un’altra rete l’iscrizione deve passare').toBe('persona7@esempio.it');
  }, 60000);
});
