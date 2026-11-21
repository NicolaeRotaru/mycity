/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { indirizzoContatto } from '@/lib/contatti-pubblici';

/**
 * R03-020 — ANCHE CHI SCEGLIE «VENDITORE» VEDEVA IL PULSANTE GOOGLE, CHE CREA UN CLIENTE.
 *
 * Verificato in sola lettura: il pulsante Google (components/ui/AuthShell.tsx, AuthAlternatives)
 * chiama signInWithOAuth senza `data`, /auth/callback non tocca il ruolo, e handle_new_user
 * (migrations/421) legge `raw_user_meta_data.role`, che con Google non c'è: il profilo nasce
 * 'buyer'. Il negoziante che preme Google diventa cliente e il negozio non nasce. Come per il
 * fattorino (R02-009): con Venditore scelto Google non si mostra, una riga dice che i negozi si
 * iscrivono con email e password, e il riquadro anti-robot rotto non consiglia Google.
 * (Attrezzatura copiata da riparazione-r02-iscrizione-fattorino-senza-google.)
 *
 * Qui si monta la pagina VERA e si guarda quello che vede la persona.
 */

const avvisi = vi.hoisted(() => ({ errori: [] as string[] }));
vi.mock('sonner', async (originale) => {
  const vero = await originale<typeof import('sonner')>();
  const toast = Object.assign((...a: Parameters<typeof vero.toast>) => vero.toast(...a), vero.toast, {
    error: (m: unknown) => {
      avvisi.errori.push(String(m));
      return 0;
    },
  });
  return { ...vero, toast };
});

type Pagina = ComponentType<Record<string, unknown>>;
type G = Record<string, unknown> & {
  __QUERY_FINTA__?: string;
  __AUTH_FINTA__?: Record<string, (...a: unknown[]) => unknown>;
  __NAVIGAZIONI__?: Array<{ tipo: string; dove: string }>;
};
const g = globalThis as unknown as G;
const w = window as unknown as Record<string, unknown>;

const RIGA_NEGOZIO = 'Con Google si crea un account cliente: i negozi si iscrivono con email e password.';

let Registrazione: Pagina;
const chiavePrima = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
beforeAll(async () => {
  // La chiave pubblica di prova di Cloudflare (sempre «passa»): niente di vero.
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
  Registrazione = (await monta('app/sign-up/page.tsx')).default as Pagina;
}, 120000);
afterAll(() => {
  if (chiavePrima === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = chiavePrima;
});

const montate: Array<{ smonta: () => void }> = [];
afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__QUERY_FINTA__;
  delete g.__AUTH_FINTA__;
  delete g.__NAVIGAZIONI__;
  avvisi.errori = [];
  delete w.__turnstileLoaded;
  delete w.turnstile;
  vi.unstubAllGlobals();
});

async function aspettaChe(vero: () => boolean, ms = 3000) {
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

/** Il riquadro anti-robot: `rotto` = il riquadro non si apre (il componente vero chiama onError). */
function antiRobot(rotto: boolean) {
  w.__turnstileLoaded = true;
  w.turnstile = {
    render: () => {
      if (rotto) throw new Error('riquadro rotto');
      return 'riquadro-1';
    },
    remove: () => undefined,
    reset: () => undefined,
  };
}

async function apri(percorso: string, opzioni: { antiRobotRotto?: boolean } = {}) {
  antiRobot(Boolean(opzioni.antiRobotRotto));
  const [path, query = ''] = percorso.split('?');
  window.history.replaceState(null, '', percorso);
  g.__QUERY_FINTA__ = query;
  (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = path;
  const s = accendi(Registrazione);
  montate.push(s);
  await aspettaChe(() => testoVisibile(s.radice).includes('Crea il tuo account'));
  expect(testoVisibile(s.radice), 'la pagina di iscrizione non si è montata: la prova non guarda niente').toContain(
    'Crea il tuo account',
  );
  return s;
}

function pulsanteGoogle(radice: HTMLElement): HTMLButtonElement | undefined {
  return [...radice.querySelectorAll<HTMLButtonElement>('button')].find((b) => /Google/.test(b.textContent ?? ''));
}
function mattonella(radice: HTMLElement, titolo: string): HTMLButtonElement {
  const b = [...radice.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((x) =>
    (x.textContent ?? '').includes(titolo),
  );
  if (!b) throw new Error(`manca la mattonella «${titolo}»`);
  return b;
}

describe('R03-020 · con «Venditore» scelto l’iscrizione non offre Google, che creerebbe un cliente', () => {
  it('dal link /sign-up?role=seller: nessun pulsante Google e la riga che spiega', async () => {
    const s = await apri('/sign-up?role=seller');
    expect(mattonella(s.radice, 'Venditore').getAttribute('aria-pressed'), 'controprova: il ruolo dal link è Venditore').toBe('true');
    expect(pulsanteGoogle(s.radice), 'con Venditore scelto c’è ancora il pulsante Google: chi lo preme diventa cliente').toBeUndefined();
    expect(testoVisibile(s.radice)).toContain(RIGA_NEGOZIO);
  });

  it('col ruolo cliente il pulsante Google c’è, e la riga dei negozi no', async () => {
    for (const percorso of ['/sign-up?role=buyer', '/sign-up']) {
      const s = await apri(percorso);
      expect(mattonella(s.radice, 'Acquirente').getAttribute('aria-pressed')).toBe('true');
      expect(pulsanteGoogle(s.radice), `${percorso}: il pulsante Google è sparito anche per il cliente`).toBeDefined();
      expect(testoVisibile(s.radice)).not.toContain(RIGA_NEGOZIO);
      montate.pop()!.smonta();
    }
  });

  it('scegliendo la mattonella «Venditore» Google sparisce, tornando ad «Acquirente» ricompare', async () => {
    const s = await apri('/sign-up');
    expect(pulsanteGoogle(s.radice)).toBeDefined();
    s.agisci(() => mattonella(s.radice, 'Venditore').click());
    expect(pulsanteGoogle(s.radice), 'scelto Venditore con la mattonella, il pulsante Google è ancora lì').toBeUndefined();
    expect(testoVisibile(s.radice)).toContain(RIGA_NEGOZIO);
    s.agisci(() => mattonella(s.radice, 'Acquirente').click());
    expect(pulsanteGoogle(s.radice)).toBeDefined();
    expect(testoVisibile(s.radice)).not.toContain(RIGA_NEGOZIO);
  });

  it('col riquadro anti-robot rotto e Venditore scelto, né la riga né il messaggio a comparsa consigliano Google', async () => {
    const iscrizioni: unknown[] = [];
    g.__AUTH_FINTA__ = { signUp: (d) => (iscrizioni.push(d), { data: { user: null, session: null }, error: null }) };
    vi.stubGlobal('fetch', async (dove: unknown) => {
      iscrizioni.push(String(dove));
      return { ok: false, status: 400, json: async () => ({ ok: false, error: { code: 'INVALID_REQUEST', message: 'CAPTCHA mancante' } }) };
    });
    g.__NAVIGAZIONI__ = [];
    const s = await apri('/sign-up?role=seller', { antiRobotRotto: true });

    const motivo = 'Il controllo anti-bot non si è aperto.';
    await aspettaChe(() => testoVisibile(s.radice).includes(motivo));
    const riquadro = s.radice.querySelector<HTMLElement>('p[role="alert"]');
    expect(riquadro, 'il componente anti-robot non ha segnalato il guasto: la prova non guarda niente').not.toBeNull();
    expect(testoVisibile(riquadro)).toContain(motivo);
    expect(testoVisibile(riquadro), 'col riquadro rotto si consiglia Google a chi ha scelto Venditore').not.toMatch(/Google/);
    expect(riquadro!.querySelector('a')?.getAttribute('href')).toBe(`mailto:${indirizzoContatto('info')}`);

    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-email')!, 'forno@esempio.it');
    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-password')!, 'una-password-lunga');
    s.agisci(() => s.radice.querySelector<HTMLInputElement>('#signup-consenso')!.click());
    void act(() => {
      s.radice.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await aspettaChe(() => avvisi.errori.length > 0, 600);

    expect(iscrizioni, 'senza gettone il modulo è partito lo stesso').toHaveLength(0);
    const avviso = avvisi.errori.at(-1) ?? '';
    expect(avviso, 'premuto «Registrati» col riquadro rotto non è comparso nessun messaggio').not.toBe('');
    expect(avviso.startsWith(motivo)).toBe(true);
    expect(avviso, `il messaggio a comparsa consiglia Google a chi ha scelto Venditore: «${avviso}»`).not.toMatch(/Google/);
  }, 30000);
});
