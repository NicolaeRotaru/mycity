/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 13/11/2026 (R24-016) — «PUOI PROVARE LO STESSO A REGISTRARTI», MA NON SI POTEVA.
 *
 * Quando il riquadro anti-robot non si carica, la pagina di iscrizione diceva di
 * provare lo stesso e lasciava partire il modulo senza gettone. La rotta del
 * server, senza gettone, rifiuta sempre: un giro senza uscita. Come sull'accesso
 * (scheda 278), il modulo non parte e la pagina dice cosa fare davvero.
 *
 * Qui il riquadro si rompe davvero: `turnstile.render` lancia, il componente
 * vero chiama `onError`, e si guarda cosa vede e cosa può fare la persona.
 */

type Pagina = ComponentType<Record<string, unknown>>;
type G = Record<string, unknown> & {
  __QUERY_FINTA__?: string;
  __AUTH_FINTA__?: Record<string, (...a: unknown[]) => unknown>;
  __NAVIGAZIONI__?: Array<{ tipo: string; dove: string }>;
};
const g = globalThis as unknown as G;
const w = window as unknown as Record<string, unknown>;

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

describe('l’anti-robot che non si carica non promette una strada che non c’è', () => {
  it('IL CASO CHE ROMPEVA — il modulo non parte senza gettone e la pagina dice cosa fare', async () => {
    // Lo script di Cloudflare «c'è», ma il riquadro non si apre.
    w.__turnstileLoaded = true;
    w.turnstile = {
      render: () => {
        throw new Error('riquadro rotto');
      },
      remove: () => undefined,
    };
    const iscrizioni: unknown[] = [];
    g.__AUTH_FINTA__ = { signUp: (d) => (iscrizioni.push(d), { data: { user: null, session: null }, error: null }) };
    vi.stubGlobal('fetch', async (dove: unknown) => {
      iscrizioni.push(String(dove));
      return { ok: false, status: 400, json: async () => ({ ok: false, error: { code: 'INVALID_REQUEST', message: 'CAPTCHA mancante' } }) };
    });
    g.__NAVIGAZIONI__ = [];
    window.history.replaceState(null, '', '/sign-up');
    g.__QUERY_FINTA__ = '';
    (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = '/sign-up';
    const s = accendi(Registrazione);
    montate.push(s);

    await aspettaChe(() => testoVisibile(s.radice).includes('non si è aperto'));
    expect(testoVisibile(s.radice), 'il componente anti-robot non ha segnalato il guasto: la prova non guarda niente').toContain(
      'non si è aperto',
    );
    expect(testoVisibile(s.radice)).not.toMatch(/provare lo stesso/i);
    expect(testoVisibile(s.radice)).toMatch(/non può partire/);
    expect(testoVisibile(s.radice)).toMatch(/Google/);

    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-email')!, 'anna@esempio.it');
    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-password')!, 'una-password-lunga');
    s.agisci(() => s.radice.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    void act(() => {
      s.radice.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await aspettaChe(() => iscrizioni.length > 0, 600);

    expect(iscrizioni, 'senza gettone il modulo è partito lo stesso: il server lo rifiuta sempre').toHaveLength(0);
    expect(g.__NAVIGAZIONI__).toEqual([]);
  }, 30000);
});
