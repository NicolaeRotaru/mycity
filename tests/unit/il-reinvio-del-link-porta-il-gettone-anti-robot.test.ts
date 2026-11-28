/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';
import { CHIAVE_EMAIL_DA_CONFERMARE } from '@/lib/auth/conferma-email';

/**
 * «Reinvia email di verifica» (/auth/verify-email) mostra il riquadro anti-robot e passa il suo
 * gettone a Supabase insieme alla richiesta: col CAPTCHA acceso su Supabase il reinvio lo vuole.
 * Dopo ogni reinvio il riquadro si rifà, perché il gettone vale una volta.
 *
 * In fondo: la configurazione del CAPTCHA su Supabase è scritta in .env.example e nel README.
 */

type Pagina = ComponentType<Record<string, unknown>>;
type G = Record<string, unknown> & { __QUERY_FINTA__?: string; __AUTH_FINTA__?: Record<string, (...a: unknown[]) => unknown> };
const g = globalThis as unknown as G;
const w = window as unknown as Record<string, unknown>;

let Verifica: Pagina;
const chiavePrima = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
beforeAll(async () => {
  // La chiave pubblica di prova di Cloudflare (sempre «passa»): niente di vero.
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
  Verifica = (await monta('app/auth/verify-email/page.tsx')).default as Pagina;
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
  delete w.__turnstileLoaded;
  delete w.turnstile;
  window.sessionStorage.clear();
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

function pulsante(radice: HTMLElement, testo: RegExp): HTMLButtonElement | null {
  return ([...radice.querySelectorAll('button')].find((b) => testo.test(testoVisibile(b))) ?? null) as HTMLButtonElement | null;
}

describe('il reinvio del link di conferma', () => {
  it('passa a Supabase il gettone del riquadro anti-robot, e dopo il riquadro si rifà', async () => {
    const riquadro = { disegnati: 0, rifatti: 0, richiamo: null as null | ((t: string) => void) };
    w.__turnstileLoaded = true;
    w.turnstile = {
      render: (_el: unknown, opzioni: { callback: (t: string) => void }) => {
        riquadro.disegnati += 1;
        riquadro.richiamo = opzioni.callback;
        return 'riquadro-1';
      },
      remove: () => undefined,
      reset: () => {
        riquadro.rifatti += 1;
      },
    };
    const rinvii: Array<{ options?: { captchaToken?: string } }> = [];
    g.__AUTH_FINTA__ = {
      resend: (dati) => {
        rinvii.push(dati as (typeof rinvii)[number]);
        return { data: {}, error: null };
      },
    };
    window.sessionStorage.setItem(CHIAVE_EMAIL_DA_CONFERMARE, 'maria.rossi@esempio.it');
    window.history.replaceState(null, '', '/auth/verify-email');
    g.__QUERY_FINTA__ = '';
    (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = '/auth/verify-email';
    const s = accendi(Verifica);
    montate.push(s);

    await aspettaChe(() => riquadro.disegnati > 0 && pulsante(s.radice, /Reinvia/)?.disabled === false);
    expect(riquadro.disegnati, 'la pagina non disegna il riquadro anti-robot').toBe(1);
    s.agisci(() => riquadro.richiamo!('gettone-del-reinvio'));

    s.agisci(() => clicca(pulsante(s.radice, /Reinvia/)!));
    await aspettaChe(() => !!s.radice.querySelector('[role="status"]'));

    expect(rinvii, 'il clic su «Reinvia» non ha rimandato niente').toHaveLength(1);
    expect(rinvii[0].options?.captchaToken, 'il reinvio parte senza il gettone anti-robot').toBe('gettone-del-reinvio');
    expect(riquadro.rifatti, 'dopo il reinvio il riquadro non chiede un gettone nuovo').toBe(1);
  }, 30000);
});

describe('la configurazione del CAPTCHA su Supabase è scritta', () => {
  const RADICE = process.cwd();

  it('.env.example ha l\'interruttore CAPTCHA_SU_SUPABASE_ACCESO, vuoto', () => {
    const esempio = readFileSync(join(RADICE, '.env.example'), 'utf8');
    expect(esempio).toMatch(/^CAPTCHA_SU_SUPABASE_ACCESO=$/m);
  });

  it('il README dice chi verifica il gettone dell\'iscrizione e rimanda all\'interruttore', () => {
    const leggimi = readFileSync(join(RADICE, 'README.md'), 'utf8');
    expect(leggimi).not.toMatch(/✅ Turnstile CAPTCHA su signup/);
    expect(leggimi).toContain('CAPTCHA_SU_SUPABASE_ACCESO');
  });
});
